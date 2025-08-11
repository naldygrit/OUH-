import { USSDMessage, DeviceType } from '../types';

export class MessageFormatter {
  static formatMessage(content: string, deviceType: DeviceType): USSDMessage {
    const maxLength = deviceType === 'basic' ? 182 : 160;
    let truncated = false;
    let formattedContent = content;

    if (content.length > maxLength) {
      truncated = true;
      // Smart truncation - try to break at word boundaries
      const words = content.slice(0, maxLength).split(' ');
      words.pop(); // Remove last potentially cut word
      formattedContent = words.join(' ') + '...';
      
      // If still too long, hard truncate
      if (formattedContent.length > maxLength) {
        formattedContent = content.slice(0, maxLength - 3) + '...';
      }
    }

    return {
      content: formattedContent,
      truncated,
      characterCount: formattedContent.length,
      maxLength
    };
  }

  static addCharacterCounter(message: USSDMessage): string {
    if (message.truncated) {
      return `${message.content}\n[${message.characterCount}/${message.maxLength} - TRUNCATED]`;
    }
    return `${message.content}\n[${message.characterCount}/${message.maxLength}]`;
  }
}

