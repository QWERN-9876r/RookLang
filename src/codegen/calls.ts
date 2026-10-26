import type * as ast from '../ast.ts';
import { elementOf, isChan } from '../checker/channel.ts';
import {
  isNullable,
  isQueue,
  isTopic,
  nonNull,
  topicElement,
  typedArrayOf,
  type Type,
} from '../checker/types.ts';
import { goCaptures, goParams, goTarget } from '../goroutines.ts';
import { isYieldCall } from '../iterators.ts';
import { TYPED_ARRAYS, TYPED_ELEMENTS } from '../typed-arrays.ts';
import { hasOptionalLink } from './analysis.ts';
import { ExpressionEmitter } from './expressions.ts';
import { ARROW, BINARY, POSTFIX } from './syntax.ts';

// Calls, `new`, array literals and conversions. A `[]byte` is a Uint8Array: a literal where the
// checker found one expected becomes `new Uint8Array([...])`, and the conversions of Go between
// text and its UTF-8 bytes use TextEncoder and TextDecoder, `[]byte(s)` and `string(data)`. In an
// iterator, a generator, `yield(v)` yields: its value is `true`, since a generator that the loop
// over it leaves is closed at that `yield` and goes no further, so `false` is never seen. Making
// channels, queues and topics is here too, with what a topic needs where it is received or closed.

export abstract class CallEmitter extends ExpressionEmitter {
  protected override call(node: ast.CallExpression): string {
    // After `?.` the arguments may not be evaluated at all.
    const conditional = node.optional || hasOptionalLink(node.callee);
    const args = this.withHoisting(this.hoist && !conditional, () => this.elements(node.arguments));

    // `error("load user", err)` wraps an error, with its message after this one (runtime/core.js).
    if (this.isBuiltinError(node.callee) && !node.optional) {
      return node.arguments.length > 1 ? `$$wrap(${args})` : `new Error(${args})`;
    }

    if (this.isStringConversion(node.callee)) return `new TextDecoder().decode(${args})`;

    const yielded = this.yielded(node);

    if (yielded !== null) return `(${yielded}, true)`;

    // `close(t)` of a topic: it stops listening and sending.
    const [argument] = node.arguments;

    if (
      node.callee.kind === 'Identifier' &&
      node.callee.name === 'close' &&
      this.lookup('close') === undefined &&
      argument?.kind !== 'SpreadElement' &&
      argument !== undefined &&
      this.isTopicValue(argument)
    ) {
      return `$$Topic.close(${args})`;
    }

    return `${this.expression(node.callee, POSTFIX)}${node.optional ? '?.' : ''}(${args})`;
  }

  /**
   * `go f(x)`: the worker module has the function under the same name, a literal under the name
   * given to it, after the local names it uses; the arguments are copied there. In the worker
   * module a literal runs in the same worker, with copies of those names as its first parameters.
   */
  protected override go(node: ast.GoExpression): string {
    const { callee } = node.call;
    const literal = callee.kind === 'FuncExpression' ? callee : null;
    const captured = literal ? goCaptures(this.program, node) : [];
    const args = [...captured.map((name) => this.name(name)), this.elements(node.call.arguments)];
    // Without type checking, a callee that is neither fails when the call runs.
    const fn =
      literal && this.inWorker
        ? this.expression(
            { ...literal, params: [...goParams(literal, captured), ...literal.params] },
            ARROW,
          )
        : JSON.stringify(goTarget(this.program, node));

    return `$$go(${fn}, [${args.filter((arg) => arg !== '').join(', ')}])`;
  }

  /** `yield v` for `yield(v)` in an iterator, `yield [k, v]` for `yield(k, v)`; else `null`. */
  private yielded(node: ast.Expression): string | null {
    if (!this.fn.iterator || !isYieldCall(node) || this.lookup('yield') !== 'param') return null;

    const values = node.arguments.map((argument) =>
      this.expression(argument.kind === 'SpreadElement' ? argument.argument : argument, ARROW),
    );

    return values.length === 1 ? `yield ${values[0]}` : `yield [${values.join(', ')}]`;
  }

  protected override expressionStatement(node: ast.Expression): string {
    return this.yielded(node) ?? super.expressionStatement(node);
  }

  /** `if !yield(v) { return }`, the way an iterator of Go stops: in a generator, `yield v`. */
  protected yieldStatement(node: ast.IfStatement): string | null {
    const [only] = node.consequent.body;
    const { condition } = node;

    if (
      node.init ||
      node.alternate ||
      node.consequent.body.length !== 1 ||
      only?.kind !== 'ReturnStatement' ||
      only.values.length > 0 ||
      condition.kind !== 'UnaryExpression' ||
      condition.operator !== '!'
    ) {
      return null;
    }

    return this.yielded(condition.argument);
  }

  /** `string(data)`, unless `string` is the name of a value here. */
  private isStringConversion(callee: ast.Expression): boolean {
    return callee.kind === 'Identifier' && callee.name === 'string' && !this.lookup('string');
  }

  protected override newExpression(node: ast.NewExpression): string {
    return `new ${this.newCallee(node.callee)}(${this.elements(node.arguments)})`;
  }

  /** `new (f())()` and `new (a?.B)()` need parentheses around the class expression. */
  private newCallee(callee: ast.Expression): string {
    let node = callee;
    let needsParens = false;

    while (true) {
      if (node.kind === 'CallExpression') {
        needsParens = true;
        break;
      }

      if (node.kind !== 'MemberExpression' && node.kind !== 'IndexExpression') break;
      if (node.optional) {
        needsParens = true;
        break;
      }

      node = node.object;
    }

    return this.expression(callee, POSTFIX, needsParens);
  }

  protected override arrayLiteral(node: ast.ArrayLiteral): string {
    const array = `[${this.elements(node.elements)}]`;
    const type = this.options.types?.get(node);
    const typed = type && typedArrayOf(type);

    return typed ? `new ${typed}(${array})` : array;
  }

  /**
   * `make([]float64, n)` → `new Float64Array(n)`; with `shared`, on a SharedArrayBuffer of its
   * size in bytes, `new Float64Array($$shared(8 * n))`. Without types the name is the one written.
   */
  protected override make(node: ast.MakeExpression): string {
    const type = this.options.types?.get(node);
    const written =
      node.type.kind === 'ArrayType' && node.type.element.kind === 'TypeReference'
        ? TYPED_ELEMENTS.get(node.type.element.name.name)
        : node.type.kind === 'TypeReference'
          ? node.type.name.name
          : undefined;
    const typed = (type && typedArrayOf(type)) ?? written ?? 'Array';

    if (!node.shared) return `new ${typed}(${this.expression(node.length, ARROW)})`;

    const size = TYPED_ARRAYS.get(typed) ?? 1;
    const bytes =
      size === 1
        ? this.expression(node.length, ARROW)
        : `${size} * ${this.expression(node.length, BINARY['*'] + 1)}`;

    return `new ${typed}($$shared(${bytes}))`;
  }

  protected override conversion(node: ast.ConversionExpression): string {
    return `new TextEncoder().encode(${this.expression(node.argument, 0)})`;
  }

  /** `chan<number>(10)`: the channel keeps the zero value that a closed one gives. */
  protected override chan(node: ast.ChanExpression): string {
    const size = node.size ? this.expression(node.size, ARROW) : '0';

    return `$$Channel.make(${size}, ${this.zeroValue(node.element) ?? 'null'})`;
  }

  /** `queue<number>(items)`: the queue copies the values, as `[...items]` would. */
  protected override queue(node: ast.QueueExpression): string {
    return `new $$Queue(${node.items ? this.expression(node.items, ARROW) : ''})`;
  }

  /** Whether the checker found a topic here, or a `?topic T` in a case of `select`. */
  protected isTopicValue(node: ast.Expression): boolean {
    const type = this.options.types?.get(node);

    return type !== undefined && isTopic(isNullable(type) ? nonNull(type) : type);
  }

  /**
   * The channel that `<-x`, `for v in x` and a case of `select` receive from: a topic listens from
   * the first of them on, into a channel of its own (src/runtime/topic.js).
   */
  protected receivedFrom(node: ast.Expression): string {
    const channel = this.expression(node, ARROW);

    return this.isTopicValue(node) ? `$$Topic.listen(${channel})` : channel;
  }

  /**
   * The zero value that `<-x` gives if `x` is `Channel.EMPTY` or `Topic.EMPTY`, which are the same
   * for all types; any other channel keeps its own. `null` when it is null.
   */
  protected receivedZero(node: ast.Expression): string {
    const type = this.options.types?.get(node);
    const channel = type && (isNullable(type) ? nonNull(type) : type);

    if (channel && isChan(channel)) return zeroOf(elementOf(channel));
    if (channel && isTopic(channel)) return zeroOf(topicElement(channel));

    return 'null';
  }

  protected override receive(node: ast.Expression, withOk: boolean): string {
    const zero = this.receivedZero(node);
    const args = zero !== 'null' ? `, ${withOk}, ${zero}` : withOk ? ', true' : '';

    return `$$Channel.receive(${this.receivedFrom(node)}${args})`;
  }

  /** `ch <- v` waits until the channel takes the value; a topic sends and goes on. */
  protected send(node: ast.SendStatement): string {
    const channel = this.expression(node.channel, ARROW);
    const value = this.expression(node.value, ARROW);

    return this.isTopicValue(node.channel)
      ? `$$Topic.publish(${channel}, ${value})`
      : `await $$Channel.send(${channel}, ${value})`;
  }

  /** `topic<T>(name)`: a topic keeps the zero value that a closed one gives, as a channel does. */
  protected override topic(node: ast.TopicExpression): string {
    return `$$Topic.make(${this.expression(node.name, ARROW)}, ${this.zeroValue(node.element) ?? 'null'})`;
  }

  /**
   * `chan(stream, size)`: the channel keeps the zero value of its values, as `chan<T>(size)` does,
   * from the type of the stream that the checker found; without it, null.
   */
  protected override streamChan(node: ast.StreamChanExpression): string {
    const stream = this.expression(node.stream, ARROW);
    const size = node.size ? this.expression(node.size, ARROW) : '0';
    const type = this.options.types?.get(node);
    const channel = type?.kind === 'tuple' ? type.types[0] : undefined;
    const element = channel?.kind === 'object' ? channel.instanceOf?.args[0] : undefined;

    return `$$Channel.fromStream(${stream}, ${size}, ${element ? zeroOf(element) : 'null'})`;
  }
}

/** The zero value of a type, as zeroValue gives for a type as written. */
function zeroOf(type: Type): string {
  const typed = typedArrayOf(type);

  if (typed !== null) return `new ${typed}()`;

  switch (type.kind) {
    case 'number':
      return '0';

    case 'bigint':
      return '0n';

    case 'string':
      return '""';

    case 'bool':
      return 'false';

    case 'array':
      return '[]';

    case 'object':
      if (isQueue(type)) return 'new $$Queue()';
      if (isChan(type)) return '$$Channel.EMPTY';

      return isTopic(type) ? '$$Topic.EMPTY' : 'null';

    default:
      return 'null';
  }
}
