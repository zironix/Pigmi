import eslint from '@eslint/js';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      '.vite/**',
      'build/**',
      'coverage/**',
      'landing/**',
      'node_modules/**',
      'out/**',
      'src/assets/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-assignment': 'off',
      'vue/html-self-closing': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/no-mutating-props': ['error', { shallowOnly: true }],
      'vue/no-v-html': 'off',
    },
  },
  {
    files: ['src/**/*.{js,ts,vue}'],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      'no-constant-binary-expression': 'error',
      'no-duplicate-imports': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-useless-assignment': 'off',
      'object-shorthand': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: [
      'eslint.config.js',
      'forge.config.js',
      'mcp/**/*.mjs',
      'vite.*.config.mjs',
      'src/main.js',
      'src/main/**/*.js',
      'src/preload.js',
      'tests/**/*.js',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        MAIN_WINDOW_VITE_DEV_SERVER_URL: 'readonly',
        MAIN_WINDOW_VITE_NAME: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
