import type * as ast from '../ast.ts';
import { CallChecker, withDefaults } from './calls.ts';
import { callSignature, isUntyped, signaturesOf } from './helpers.ts';
import {
  ANY,
  containsTypeParam,
  inferTypeParams,
  nonNull,
  substitute,
  typeToString,
  UNKNOWN,
  VOID,
  type FunctionType,
  type Type,
  type TypeParam,
} from './types.ts';

// Tagged templates, sql`select * from users where id = ${id}`: a call of the tag with the strings
// of the template, a TemplateStringsArray, and its values, which are checked as the arguments that
// follow the strings.

export abstract class TagChecker extends CallChecker {
  protected override checkTaggedTemplate(node: ast.TaggedTemplateExpression): Type {
    const tag = this.checkValue(node.tag);
    const values = node.quasi.expressions;
    const signature = isUntyped(tag) ? null : callSignature(nonNull(tag));

    if (!signature) {
      if (!isUntyped(tag)) {
        this.error(
          `${typeToString(tag)} cannot be a tag: a tag is a function, e.g. func sql(parts TemplateStringsArray, ...values []any)`,
          node.tag,
        );
      }

      for (const value of values) this.checkValue(value);

      return isUntyped(tag) ? ANY : UNKNOWN;
    }

    // Of overloads, the one that takes the strings of a template, as `sql` of postgres has.
    const chosen = signaturesOf(signature).find(takesTemplate) ?? signature;
    const inferred = new Map<TypeParam, Type>();

    values.forEach((value, i) => {
      const param = chosen.params[i + 1] ?? chosen.rest;

      if (!param) {
        this.error(
          `too many values for the tag: it takes ${chosen.params.length - 1} after the strings`,
          value,
        );
        this.checkValue(value);

        return;
      }

      const type = this.checkValue(value, containsTypeParam(param) ? null : param);

      inferTypeParams(param, type, inferred);
      this.expectAssignable(type, substitute(param, inferred), value, ` in value ${i + 1}`);
    });

    const [result] = chosen.results;

    return result ? substitute(result, withDefaults(chosen.typeParams, inferred)) : VOID;
  }
}

/** Whether the first parameter takes the strings of a template: TemplateStringsArray or []string. */
function takesTemplate(signature: FunctionType): boolean {
  const [first] = signature.params;

  return (
    first !== undefined &&
    ((first.kind === 'object' && first.name === 'TemplateStringsArray') ||
      (first.kind === 'array' && first.element.kind === 'string'))
  );
}
