/**
 * Transformateur Jest des dépendances publiées en ESM seul (aujourd'hui `jose` 6, A9-b3).
 *
 * Jest 29 exécute du CommonJS : sans transformation, `require('jose')` échoue (« Cannot use import
 * statement outside a module »). On traduit le vrai paquet en CommonJS avec le compilateur
 * TypeScript du dépôt (aucune doublure, aucun `jest.mock('jose')`) : les tests exercent le code
 * réel de la bibliothèque. `ts-jest` ne convient pas ici : son service de langage n'émet pas les
 * fichiers JavaScript de `node_modules`, et deux entrées `ts-jest` d'une même configuration
 * partagent les mêmes options.
 *
 * Portée : uniquement les fichiers que `transformIgnorePatterns` laisse passer (voir `package.json`
 * et `jest-e2e.json`).
 */
const { createHash } = require('crypto');
const { readFileSync } = require('fs');
const ts = require('typescript');

const SELF = readFileSync(__filename, 'utf8');

module.exports = {
  process(source, filename) {
    const { outputText, diagnostics } = ts.transpileModule(source, {
      fileName: filename,
      reportDiagnostics: true,
      compilerOptions: {
        allowJs: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        sourceMap: false,
        inlineSourceMap: true,
      },
    });
    const errors = (diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (errors.length > 0) {
      const text = ts.flattenDiagnosticMessageText(errors[0].messageText, '\n');
      throw new Error(`Transformation de ${filename} impossible : ${text}`);
    }
    return { code: outputText };
  },
  getCacheKey(source, filename) {
    return createHash('sha256')
      .update(SELF)
      .update(ts.version)
      .update(filename)
      .update(source)
      .digest('hex');
  },
};
