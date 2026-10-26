import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';

/** Guía de estilo oficial de Angular, con nomenclatura del proyecto. */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.angular/**', 'eslint.config.mjs'] },
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'sipra', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'sipra', style: 'kebab-case' },
      ],
      // OnPush es obligatorio en todos los componentes nuevos.
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@angular-eslint/prefer-standalone': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
  },
);
