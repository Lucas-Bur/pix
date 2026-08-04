export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith(".") && specifier.endsWith(".js")) {
    try {
      return await defaultResolve(`${specifier.slice(0, -3)}.ts`, context, defaultResolve)
    } catch {
      // Keep normal JavaScript resolution for actual .js modules.
    }
  }
  return defaultResolve(specifier, context, defaultResolve)
}
