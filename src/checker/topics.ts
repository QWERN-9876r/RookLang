import type * as ast from '../ast.ts';
import { QueueChecker } from './queues.ts';
import { notBroadcast } from './transfer.ts';
import { STRING, topicOf, type Type } from './types.ts';

// Topics: `topic<T>(name)` makes one, and its values go to the other tabs of the site as copies,
// so they must be data without channels. `t <- v` sends (channels.ts), `<-t` receives
// (operators.ts) and `for v in t` receives them until it is closed (loops.ts).

export abstract class TopicChecker extends QueueChecker {
  protected override checkTopic(node: ast.TopicExpression): Type {
    const element = this.resolveType(node.element);
    const reason = notBroadcast(element);

    if (reason !== null) {
      this.error(`the values of a topic go to other tabs as copies: ${reason}`, node.element);
    }

    this.expectAssignable(this.checkValue(node.name, STRING), STRING, node.name);

    return topicOf(element);
  }
}
