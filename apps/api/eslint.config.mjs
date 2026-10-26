import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Reglas de codificación de la API.
 *
 * La regla de dependencia de la arquitectura hexagonal se hace cumplir aquí:
 * el dominio no puede importar infraestructura ni framework. Si alguien lo
 * intenta, el lint falla y la integración continua no pasa.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-member-accessibility': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // Los puertos del dominio son asíncronos por contrato. Un adaptador que
      // hoy resuelve de forma síncrona (simulado, disco local) debe conservar
      // la firma `async` para que sustituirlo por la implementación real
      // —GCS, RUES, SINU— no cambie ni una línea del caso de uso.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // ── Regla de dependencia (arquitectura hexagonal) ─────────────────────
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', 'typeorm', '@google-cloud/*', 'fastify', 'pg'],
              message:
                'El dominio no depende de infraestructura ni de framework. Defina un puerto en ' +
                'domain/ports e impleméntelo en infrastructure/adapters.',
            },
            {
              group: ['../../infrastructure/**', '**/infrastructure/**', '**/application/**'],
              message: 'Las dependencias solo apuntan hacia adentro: el dominio no conoce las capas externas.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['typeorm', '@google-cloud/*', 'pg', '**/infrastructure/persistence/**'],
              message:
                'La capa de aplicación orquesta casos de uso; la persistencia concreta vive en ' +
                'infrastructure y se inyecta por puerto.',
            },
          ],
        },
      ],
    },
  },
  {
    // Arranques de línea de órdenes y pruebas: aquí la salida por consola no es
    // un descuido, es la interfaz. Lo que en un servicio sería una traza
    // perdida, en un paso de despliegue es lo único que alguien va a leer
    // cuando algo falle.
    files: [
      '**/*.spec.ts',
      'src/migrar.ts',
      'src/infrastructure/persistence/postgres/seeds/**/*.ts',
      'src/infrastructure/persistence/postgres/catalogos/**/*.ts',
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
