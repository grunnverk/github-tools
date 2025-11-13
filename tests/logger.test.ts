import { describe, it, expect, beforeEach } from 'vitest';
import { setLogger, getLogger } from '../src/logger';
import type { Logger } from '../src/types';

describe('Logger', () => {
    beforeEach(() => {
        // Reset to default logger before each test
        setLogger({
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {},
        });
    });

    it('should have a default logger', () => {
        const logger = getLogger();
        expect(logger).toBeDefined();
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.error).toBe('function');
        expect(typeof logger.debug).toBe('function');
    });

    it('should allow setting a custom logger', () => {
        let logged = '';
        const customLogger: Logger = {
            info: (msg: string) => { logged = `info: ${msg}`; },
            warn: (msg: string) => { logged = `warn: ${msg}`; },
            error: (msg: string) => { logged = `error: ${msg}`; },
            debug: (msg: string) => { logged = `debug: ${msg}`; },
        };

        setLogger(customLogger);
        const logger = getLogger();

        logger.info('test message');
        expect(logged).toBe('info: test message');

        logger.warn('warning');
        expect(logged).toBe('warn: warning');
    });

    it('should persist custom logger across getLogger calls', () => {
        const customLogger: Logger = {
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {},
        };

        setLogger(customLogger);
        const logger1 = getLogger();
        const logger2 = getLogger();

        expect(logger1).toBe(logger2);
        expect(logger1).toBe(customLogger);
    });
});

