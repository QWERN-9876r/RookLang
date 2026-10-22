import type * as ast from '../ast.ts';
import { isUntyped } from './helpers.ts';
import { TopicChecker } from './topics.ts';
import { isText, notDecoded } from './json.ts';
import { ERROR, typedArrayOf, typeToString, type Type } from './types.ts';

// `decode<User>(body)`: the types are erased, so only the compiler knows what a User is. It writes
// the type into the JS as data (codegen/decode.ts), and the runtime checks JSON text, or a value
// from JS, against it when the program runs (runtime/decode.js). So the type must be one that JSON
// can hold (json.ts). The argument is JSON text if it is a string, and a value from JS if it is any.

export abstract class DecodeChecker extends TopicChecker {
  protected override checkDecode(node: ast.DecodeExpression): Type {
    const type = this.resolveType(node.type);
    const reason = notDecoded(type);

    if (reason !== null) this.error(`cannot decode ${typeToString(type)}: ${reason}`, node.type);

    const argument = this.checkValue(node.argument);

    if (!isUntyped(argument) && !isText(argument)) {
      this.error(this.notDecodable(argument), node.argument);
    }

    return { kind: 'tuple', types: [type, ERROR] };
  }

  /** Why decode cannot take a value of the type: it is neither JSON text nor a value from JS. */
  private notDecodable(type: Type): string {
    const prefix = `decode takes JSON text, a string, or a value of type any from JS, not ${typeToString(type)}`;

    if (type.kind === 'nullable' && isText(type.type)) {
      return `${prefix}: the text may be null, so check it first, e.g. "if text != null"`;
    }

    if (type.kind === 'object' && (typedArrayOf(type) === 'Uint8Array' || type.name === 'Buffer')) {
      return `${prefix}: make the text of the bytes first, e.g. decode<User>(string(data))`;
    }

    return `${prefix}; its type is known already`;
  }
}
