package io.adhar.service.batch;

import com.adhar.kit.batch.runtime.ExitCodes;
import org.springframework.boot.ExitCodeGenerator;

/**
 * The run was asked for something it cannot do, and retrying cannot help: an unknown job, a
 * parameter that does not parse, a scheduled run with no scheduled time, an instance that
 * needs a new identity. Exit code {@value ExitCodes#INVALID_REQUEST}: the composed Job's
 * failure policy fails the run without replacing the pod, instead of retrying it twice.
 */
public class InvalidRunException extends IllegalStateException implements ExitCodeGenerator {

    public InvalidRunException(String message) {
        super(message);
    }

    public InvalidRunException(String message, Throwable cause) {
        super(message, cause);
    }

    @Override
    public int getExitCode() {
        return ExitCodes.INVALID_REQUEST;
    }
}
