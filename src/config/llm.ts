import { ChatGoogle } from '@langchain/google/node';
import { config } from './env';

let chatModel: ChatGoogle | undefined;

export function getChatModel(): ChatGoogle {
  chatModel ??= new ChatGoogle({
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
    maxRetries: 2,
  });

  return chatModel;
}
