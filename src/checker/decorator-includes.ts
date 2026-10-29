import type * as ast from '../ast.ts';
import type { DecoratorInfo } from './context.ts';
import { DecoratorChecker } from './decorators.ts';
import { UNKNOWN, type Type } from './types.ts';

// Decorators that include others, `dec shop(margin string) includes visible(margin), cart { ... }`:
// those are applied with it, above its own body, their arguments see its parameters, and their
// public members are its own for the component, `@shop.count`.

export abstract class DecoratorIncludeChecker extends DecoratorChecker {
  protected override resolveDecoratorParams(info: DecoratorInfo): void {
    super.resolveDecoratorParams(info);

    const { node } = info;
    const current = node.name.name;
    const included = new Set<string>();

    for (const use of node.includes) {
      const name = use.name.name;
      const other = this.decorators.get(name);

      if (name === current) this.error(`@${name} cannot include itself`, use.name);
      else if (included.has(name)) this.error(`@${name} is included twice: name it once`, use.name);
      else if (node.needs.some((need) => need.name === name)) {
        this.error(`@${current} both needs and includes @${name}: includes is enough`, use.name);
      } else if (!other) this.error(`unknown decorator @${name}`, use.name);
      else info.included.push(other);
      included.add(name);
    }
  }

  /** The decorators it includes are checked before it: see orderByNeeds. */
  protected override checkDecoratorBody(info: DecoratorInfo): void {
    super.checkDecoratorBody(info);

    const { node } = info;
    const params = node.params.map((param, i): [ast.Identifier, Type] => [
      param.name,
      info.params[i] ?? UNKNOWN,
    ]);

    for (const use of node.includes) {
      const included = this.decorators.get(use.name.name);

      if (included) this.checkDecoratorArguments(use, included, params);
    }

    this.addIncludedMembers(info);

    // A module that applies it would need the code of those it includes too.
    if (node.exported && node.includes.length > 0) {
      const names = node.includes.map((use) => `@${use.name.name}`).join(' ');

      this.error(
        `@${node.name.name} is exported, so it cannot include decorators yet: apply them before it, e.g. ${names} @${node.name.name} comp ...`,
        node.includes[0]!,
      );
    }
  }

  /** The public members of the decorators it includes become its own; each name comes once. */
  private addIncludedMembers(info: DecoratorInfo): void {
    const current = info.node.name.name;
    const from = new Map<string, string>();

    for (const included of info.included) {
      const name = included.node.name.name;
      const use = info.node.includes.find((each) => each.name.name === name)!;

      for (const [member, found] of included.members) {
        const other = from.get(member);

        if (other !== undefined) {
          this.error(
            `@${current} gets "${member}" from both @${other} and @${name}: rename one of them`,
            use,
          );
        } else if (info.members.has(member)) {
          this.error(
            `@${current} declares "${member}", which it also gets from @${name}: rename one of them`,
            use,
          );
        } else {
          info.members.set(member, found);
          from.set(member, name);
        }
      }
    }
  }
}
