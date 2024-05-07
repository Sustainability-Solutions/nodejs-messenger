import { resolve } from 'path';
import { EventHandlerInterface } from '../Interfaces';
import { CommandEmitter } from '../emitter';
import { messageBody } from '../types';

export default {
  async subscribe({
    emitter,
    eventName,
    handlerFactory,
    commandPath,
  }: {
    emitter: CommandEmitter,
    eventName: string,
    handlerFactory: () => EventHandlerInterface,
    commandPath: string,
  }): Promise<void> {
    const isAbsolute = commandPath.startsWith('#');
    const absoluteCommandPath = isAbsolute ? commandPath.trim() : resolve(`${process.cwd()}/${commandPath.trim()}`);
    const resolvedCommandModule = await import(absoluteCommandPath);
    const resolvedModuleKey = Object.keys(resolvedCommandModule)[0];
    const Command = resolvedCommandModule[resolvedModuleKey];

    if (Command) {
      emitter.on(eventName, async (message: messageBody) => {
        const command = Command.fromPayload({ message });
        await handlerFactory().handle(command);
      });
    }
  },
};
