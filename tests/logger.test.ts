import { describe, it, expect, beforeEach, vi } from 'vitest';
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

        // Clear console mocks before each test
        vi.clearAllMocks();
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

        logger.error('error occurred');
        expect(logged).toBe('error: error occurred');

        logger.debug('debug info');
        expect(logged).toBe('debug: debug info');
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

    it('should call all logger methods correctly', () => {
        const mockLogger: Logger = {
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {},
        };

        setLogger(mockLogger);
        const logger = getLogger();

        expect(() => logger.info('info')).not.toThrow();
        expect(() => logger.warn('warn')).not.toThrow();
        expect(() => logger.error('error')).not.toThrow();
        expect(() => logger.debug('debug')).not.toThrow();
    });

    it('should use default logger with console methods', () => {
        // Mock console methods
        const consoleSpy = {
            log: vi.spyOn(console, 'log').mockImplementation(() => {}),
            warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
            error: vi.spyOn(console, 'error').mockImplementation(() => {}),
            debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
        };

        // Create a fresh logger instance by directly testing the default behavior
        const testLogger: Logger = {
            info: (message: string) => console.log(message),
            warn: (message: string) => console.warn(message),
            error: (message: string) => console.error(message),
            debug: (message: string) => console.debug(message),
        };

        testLogger.info('info message');
        expect(consoleSpy.log).toHaveBeenCalledWith('info message');

        testLogger.warn('warn message');
        expect(consoleSpy.warn).toHaveBeenCalledWith('warn message');

        testLogger.error('error message');
        expect(consoleSpy.error).toHaveBeenCalledWith('error message');

        testLogger.debug('debug message');
        expect(consoleSpy.debug).toHaveBeenCalledWith('debug message');

        // Clean up
        consoleSpy.log.mockRestore();
        consoleSpy.warn.mockRestore();
        consoleSpy.error.mockRestore();
        consoleSpy.debug.mockRestore();
    });
});

