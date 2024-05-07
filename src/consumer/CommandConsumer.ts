import { Channel, Message } from 'amqplib';
import { EventEmitter } from 'events';
import { getCommandEmitter } from '../container/pubSubInitialization';
import { config as configType, messageBody } from '../types';
import { amqpConnect, retryable, toJSON } from '../utils';

export default class CommandConsumer {
  private readonly transports: configType['transports']

  constructor({ config }: { config: configType}) {
    this.transports = config.transports;
  }

  async consume({
    transport,
    queueName,
    prefetchValue,
    emitter = null,
    onError,
    eventualConsistency = {
      isConsistent: async (message: messageBody)=> true,
      saveMessage: async (message: messageBody) => undefined,
    },
  }: {
    transport: string,
    queueName: string,
    prefetchValue: number,
    emitter?: EventEmitter,
    onError: ({error, message}: {error: Error, message?: messageBody}) => Promise<void>,
    eventualConsistency?: {
      isConsistent: (message: messageBody) => Promise<boolean>,
      saveMessage?: (message: messageBody) => Promise<void>
    },
  }): Promise<void> {
    if (!this.transports[transport]) {
      throw Error(`Transport ${transport} is not defined`);
    }

    const { connectionString, queues } = this.transports[transport];
    const queue = queues.find(({ name }) => name === queueName);

    if (!queue) {
      throw Error(`Queue ${queue} is not defined`);
    }

    const { retryPolicy = null } = queue;

    const connection = await amqpConnect(connectionString);

    try {
      const channel = await connection.createChannel();

      if (prefetchValue) {
        channel.prefetch(prefetchValue);
      }

      const commandEmitter = emitter === null
        ? getCommandEmitter()
        : emitter;

      const onMessage = this.workable({
        channel,
        emitter: commandEmitter,
        retryPolicy,
        queueName,
        onError,
        eventualConsistency,
      });

      channel.consume(
        queueName,
        onMessage,
        {
          noAck: false,
        },
      );
    } catch (error) {
      if (onError) await onError({ error });
      connection.close();
      throw error;
    }
  }

  workable({
    channel,
    emitter,
    retryPolicy,
    queueName,
    onError,
    eventualConsistency,
  }: {
    channel: Channel,
    emitter: EventEmitter,
    retryPolicy: {
      maxRetries: number,
      delay: number,
      retryExchangeName?: string,
      onRejected?: (message: Message) => void,
      hasDelayedPlugin?:boolean;
    },
    queueName: string,
    onError: ({ error, message }: {error: Error, message: messageBody}) => Promise<void>,
    eventualConsistency: {
      isConsistent: (message: messageBody) => Promise<boolean>,
      saveMessage?: (message: messageBody) => Promise<void>
    }
  }) {
    return async (msg: Message): Promise<void> => {
      const message = toJSON(msg);
      const { data } = message;
      const { type: eventName } = data;

      try {
        const onErrorCallback = async ({ error }) => {
          if (!retryPolicy) channel.nack(msg, false, false);

          if (onError) await onError({ error, message });

          const {
            maxRetries,
            delay,
            retryExchangeName = '',
            onRejected = null,
          } = retryPolicy;

          retryable({
            channel,
            message: msg,
            queue: {
              name: queueName,
            },
            retryExchange: {
              name: retryExchangeName,
            },
            maxRetries,
            delay,
            onRejected,
            hasDelayedPlugin: retryPolicy?.hasDelayedPlugin
          });
        };

        const onSuccess = () => {
          channel.ack(msg);
        };

        const isConsistent = await eventualConsistency.isConsistent(message);
        if(!isConsistent) {
          channel.ack(msg);
         return;
        }

        eventualConsistency.saveMessage && await eventualConsistency.saveMessage(message);
        emitter.emit(eventName, { message, onSuccess, onError: onErrorCallback });
      } catch (error) {
        if (onError) await onError({ error, message });
        channel.nack(msg, false, false);
      }
    };
  }
}
