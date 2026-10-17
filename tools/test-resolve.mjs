// Resolve bundler-style imports for Node's built-in type-stripping test runner.
import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (
        error.code !== "ERR_MODULE_NOT_FOUND" ||
        !specifier.startsWith(".") ||
        /\.[a-z]+$/i.test(specifier)
      )
        throw error;
      return next(specifier + ".ts", context);
    }
  },
});
