import { Options } from 'amqplib';
import { retryExchange, retryable } from '../types';

const assertExchange = async ({ channel, retryExchange, hasDelayedPlugin = true}: retryExchange): Promise<void> => {
  const { 'arguments': extraArgs = {}, ...options } = retryExchange.options || {};
  
  const assertExchangeOptions: Options.AssertExchange = {
    durable: !hasDelayedPlugin,
    'arguments': {
      'x-delayed-type': 'direct',
      ...extraArgs
    },
    ...options
  };
  
  await channel.assertExchange(
    retryExchange.name,
    hasDelayedPlugin ? 'x-delayed-message' : 'direct',
    assertExchangeOptions,
  );
};

export default async ({
  channel,
  message,
  queue,
  retryExchange,
  maxRetries = 5,
  delay = 5000,
  onRejected,
  hasDelayedPlugin
} : retryable): Promise<void> => {
  const { 'x-retries': xRetries } = message?.properties?.headers || {};
  const retries = xRetries ?? 0;
  const nextDelay = (retries + 1) * delay;
  
  if (retries < maxRetries) {
    await assertExchange({
      channel,
      retryExchange,
      hasDelayedPlugin
    });

    const retryRoutingKey = queue.bindingKey ?? message.fields.routingKey;
    
    await channel.bindQueue(
      queue.name,
      retryExchange.name,
      retryRoutingKey
    );
    
    channel.publish(
      retryExchange.name,
      retryRoutingKey,
      Buffer.from(message.content.toString()),
      {
        headers: {
          'x-retries': retries + 1,
          'x-delay': nextDelay,
        }
      }
    );
    
    channel.ack(message);
  } else {
    if (typeof onRejected === 'function') onRejected(message);
    channel.nack(message, false, false);
  }
};