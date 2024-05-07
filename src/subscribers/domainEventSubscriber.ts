import { resolve } from 'path';
import { DomainEventEmitter, EventDispatcher } from '../emitter';

export default {
  async subscribe({
    emitter,
    eventDispatcher,
    eventName,
    commandsPath,
  }: {
    emitter: DomainEventEmitter,
    eventDispatcher: EventDispatcher,
    eventName: string,
    commandsPath: Array<string|{path: string; mapping: (message:any)=> any}>,
  }): Promise<void> {
    for (const commandPathConfig of commandsPath) {
      const commandPath = typeof commandPathConfig === 'string' ? commandPathConfig : commandPathConfig.path;
      const mapping = typeof commandPathConfig === 'string' ? (message) => message: commandPathConfig.mapping ;
      const isAbsolute = commandPath.startsWith('#');
      const absoluteCommandPath = isAbsolute ? commandPath.trim() : resolve(`${process.cwd()}/${commandPath.trim()}`);
      const resolvedModule = await import(absoluteCommandPath);
      const resolvedModuleKey = Object.keys(resolvedModule)[0];
      const Command = resolvedModule[resolvedModuleKey];

      if (Command) {
        emitter.on(eventName, async (message) => {
          await eventDispatcher.dispatch({ event: Command.fromPayload({ message: mapping(message) }) });
        });
      }
    }
  },
};
