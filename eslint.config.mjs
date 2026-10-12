/*
 * Real linting. The script here was `echo "(lint not configured …)"`, which
 * is a gate that reports success while checking nothing — and this package
 * was shipping while nothing read it.
 *
 * `.mjs` rather than `.js` so Node does not reparse a flat config as ESM and
 * print MODULE_TYPELESS_PACKAGE_JSON on every run.
 */
import base from '@livechat/config/eslint';

export default base;
