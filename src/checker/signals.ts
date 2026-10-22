import type * as ast from '../ast.ts';
import { ChannelChecker, typeName } from './channels.ts';
import { isUntyped } from './helpers.ts';
import { isNullable, typeToString, type Type } from './types.ts';

// Signals and cancellation as channels (runtime/signals.js): `signal("SIGTERM")` gets the signals
// of the process, `done(request.signal)` the reason of an AbortSignal, and `abortSignal(stop)` is an
// AbortSignal that aborts when the channel gets a value or is closed. Their types are in
// builtins.ts; the names that signal() takes, the AbortSignal that done() takes and the type that
// abortSignal() gives, from the library if it has one, are here.

const SIGNAL = /^SIG[A-Z0-9]+$/;

export abstract class SignalChecker extends ChannelChecker {
  protected override checkCall(
    node: ast.CallExpression,
    callee: Type,
    expected: Type | null = null,
  ): Type {
    const result = super.checkCall(node, callee, expected);
    const { callee: name } = node;

    if (
      name.kind !== 'Identifier' ||
      this.lookupValue(name.name) !== this.globals.values.get(name.name)
    ) {
      return result;
    }

    switch (name.name) {
      case 'signal':
        this.checkSignalNames(node);

        return result;

      case 'done': {
        const [argument] = node.arguments;
        const type =
          argument && argument.kind !== 'SpreadElement' && this.checkedTypes.get(argument);

        if (argument && type && !isUntyped(type) && typeName(type) !== 'AbortSignal') {
          this.error(
            `done() takes an AbortSignal, such as request.signal, not ${typeToString(type)}${isNullable(type) ? ': check it for null first' : ''}`,
            argument,
          );
        }

        return result;
      }

      // An AbortSignal of the library, for `fetch(url, { signal: abortSignal(stop) })`.
      case 'abortSignal':
        return this.options.library?.type('AbortSignal') ?? result;

      default:
        return result;
    }
  }

  /** `signal("SIGINT", "SIGTERM")`: at least one name, and the names are those of signals. */
  private checkSignalNames(node: ast.CallExpression): void {
    if (node.arguments.length === 0) {
      this.error('signal() takes the signals to listen to, e.g. signal("SIGINT", "SIGTERM")', node);
    }

    for (const argument of node.arguments) {
      if (argument.kind === 'StringLiteral' && !SIGNAL.test(argument.value)) {
        this.error(
          `"${argument.value}" is not the name of a signal: they start with SIG, e.g. signal("SIGINT", "SIGTERM")`,
          argument,
        );
      }
    }
  }
}
