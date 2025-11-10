type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const format = (level: LogLevel, message: string, context?: Record<string, unknown>): string => {
  const parts = [`[${level.toUpperCase()}]`, message];
  if (context && Object.keys(context).length > 0) {
    parts.push(JSON.stringify(context));
  }
  return parts.join(' ');
};

const log = (level: LogLevel, message: string, context?: Record<string, unknown>) => {
  const line = format(level, message, context);
  switch (level) {
    case 'debug':
      console.debug(line);
      break;
    case 'info':
      console.info(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'error':
      console.error(line);
      break;
    default:
      console.log(line);
  }
};

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => log('error', message, context),
};
