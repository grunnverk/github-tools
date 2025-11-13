import type { Logger } from './types';

// Default console logger if winston isn't provided
/* eslint-disable no-console */
const defaultLogger: Logger = {
    info: (message: string) => console.log(message),
    warn: (message: string) => console.warn(message),
    error: (message: string) => console.error(message),
    debug: (message: string) => console.debug(message),
};
/* eslint-enable no-console */

let currentLogger: Logger = defaultLogger;

export const setLogger = (logger: Logger): void => {
    currentLogger = logger;
};

export const getLogger = (): Logger => currentLogger;

