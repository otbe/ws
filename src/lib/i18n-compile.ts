import globby from 'globby';
import { debug } from 'loglevel';
import { parse } from 'properties';
import { join, dirname } from 'path';
import { camelCase, uniqBy } from 'lodash';
import stringifyObject from 'stringify-object';
import { readFileAsync, readJsonAsync, outputFileAsync, removeAsync } from 'fs-extra-promise';
import { concatLanguages, isMatchingLocaleOrLanguage } from '../lib/i18n';
import { toIntlLocale } from './intl';
import { project, I18nConfig } from '../project';

const parser = require('intl-messageformat-parser');

const GENERATED_WARNING = '// this file was generated by @mercateo/ws - do not modify it manually';

const stringifyObjectOptions = {
  indent: '  '
};

interface TranslationMap {
  [key: string]: string;
}

interface AstMap {
  [key: string]: any;
}

interface Translation {
  locale: string;
  data: TranslationMap;
}

interface GroupedTranslation {
  locale: string;
  translations: Translation[];
}

interface ParsedTranslation {
  locale: string;
  data: TranslationMap;
  asts: AstMap;
}

function camelCaseKeys(data) {
  return Object.keys(data).reduce((acc, key) => {
    acc[camelCase(key)] = data[key];
    return acc;
  }, {});
}

async function readTranslation(cwd: string, dir: string, locale: string, feature: string): Promise<Translation> {
  const readPath = join(cwd, dir, feature, `${locale}.properties`);

  debug(`Read from ${readPath}.`);

  const translation: Translation = await readFileAsync(readPath, 'utf8')
    .then(parse)
    .catch(err => {
      if (err.code === 'ENOENT') {
        // translations can be "empty"
        return {};
      } else {
        throw err;
      }
    })
    .then(camelCaseKeys)
    .then(data => ({ data, locale }));

  return translation;
}

function hasArguments(ast) {
 return ast && ast.elements && ast.elements.length && ast.elements.filter(element => element.type === 'argumentElement').length;
}

function getArgumentTypes(ast) {
  const keyTypePairs = uniqBy(
    ast.elements
    .filter(element => element.type === 'argumentElement')
    .map(element => ({
      key: element.id,
      type:
        (element.format && element.format.type === 'pluralFormat')
          ? 'number'
        : (element.format && element.format.type === 'selectFormat')
          ? element.format.options.map(({ selector }) => selector === 'other' ? 'string' : `'${selector}'`).join(' | ')
          : 'string'
    })),
    'key');

  if (keyTypePairs.length) {
    return `{ ${keyTypePairs.map(({ key, type }) => `${key}: ${type}`).join(', ')} }`;
  } else {
    return '';
  }
}

function getArgument(ast, hasTypes) {
  if (hasArguments(ast)) {
    if (hasTypes) {
      return `data${getArgumentTypes(ast)}`;
    } else {
      return 'data';
    }
  } else {
    return '';
  }
}

function getDocumentation(translations: ParsedTranslation[], key: string) {
  return `
/**${translations.map(translation => `
 * \`${translation.locale}\`: ${translation.data[key]}` ).join('')}
 */`;
}

function indent(indentation: string, text: string) {
  return text.split('\n').join(`\n${indentation}`);
}

async function writeTranslation(defaultTranslation: ParsedTranslation, translation: ParsedTranslation) {
  const filename = join(project.ws.i18n!.distDir, `${translation.locale}.js`);
  const keys = Object.keys(defaultTranslation.data);
  const intlLocale = await toIntlLocale(translation.locale);

  const data =
    `${GENERATED_WARNING}
const IntlMessageFormat = require('intl-messageformat');
// use intl polyfill for IE 10 and Safari 9
require('intl');
require('intl/locale-data/jsonp/${intlLocale}');

var myModule = {};
myModule.LOCALE = '${translation.locale}';
myModule.INTL_LOCALE = '${intlLocale}';
myModule.LANGUAGE_CODE = '${translation.locale.split('_')[0]}';
myModule.COUNTRY_CODE = '${translation.locale.split('_')[1]}';

const cachedMessages = {};
${keys.map(key => `
myModule.${key} = function(${hasArguments(translation.asts[key]) ? 'data' : ''}) {${translation.asts[key] ? `
  if (!cachedMessages.${key}) {
    const ast = ${indent('    ', stringifyObject(translation.asts[key], stringifyObjectOptions))};
    cachedMessages.${key} = new IntlMessageFormat(ast, myModule.INTL_LOCALE);
  }

  return cachedMessages.${key}.format(${hasArguments(translation.asts[key]) ? 'data' : ''});`
  : `return 'Missing key "${key}".';`}
};
`).join('')}

module.exports['mercateo/i18n'] = myModule;
`;

  return outputFileAsync(filename, data);
}

async function writeTranslationUnit(translation: ParsedTranslation) {
  const filename = join(project.ws.i18n!.distDir, `unit.js`);
  const keys = Object.keys(translation.data);
  const intlLocale = await toIntlLocale(translation.locale);

  const data =
    `${GENERATED_WARNING}
const IntlMessageFormat = require('intl-messageformat');
// use intl polyfill for IE 10 and Safari 9
require('intl');
require('intl/locale-data/jsonp/${intlLocale}');

export const LOCALE = '${translation.locale}';
export const INTL_LOCALE = '${intlLocale}';
export const LANGUAGE_CODE = '${translation.locale.split('_')[0]}';
export const COUNTRY_CODE = '${translation.locale.split('_')[1]}';

const cachedMessages = {};
${keys.map(key => `
export const ${key} = (${hasArguments(translation.asts[key]) ? 'data' : ''}) => {${translation.asts[key] ? `
    if (!cachedMessages['${key}']) {
    const ast = ${indent('    ', stringifyObject(translation.asts[key], stringifyObjectOptions))};
    cachedMessages['${key}'] = new IntlMessageFormat(ast, INTL_LOCALE);
  }

  return cachedMessages['${key}'].format(${hasArguments(translation.asts[key]) ? 'data' : ''});`
  : `return 'Missing key "${key}".'`}
};
`).join('')}
`;

  return outputFileAsync(filename, data);
}

function writeDeclaration(translations: ParsedTranslation[]) {
  const filename = join(project.ws.i18n!.distDir, 'index.d.ts');
  const defaultTranslation = translations[0];
  const keys = Object.keys(defaultTranslation.data);

  const data =
    `${GENERATED_WARNING}
declare module '${project.ws.i18n!.module}' {
  /**
   * Your locale in the format \`de_DE\`, \`en_US\`, etc.
   */
  export const LOCALE;

  /**
   * Your locale in the format \`de-DE\`, \`en-US\`, etc.
   */
  export const INTL_LOCALE;

  /**
   * Your language code in the format \`de\`, \`en\`, etc.
   */
  export const LANGUAGE_CODE;

  /**
   * Your country code in the format \`DE\`, \`US\`, etc.
   */
  export const COUNTRY_CODE;${keys.map(key =>
      `
${getDocumentation(translations, key)}
  export function ${key}(${hasArguments(defaultTranslation.asts[key]) ? 'data' : ''}): string;`).join('\n')}
}
`;

  return outputFileAsync(filename, data);
}

export async function compileI18n() {
  // at this place we know i18n config is set, no need for null checks
  const i18n = project.ws.i18n as I18nConfig;

  const translatedModules: Array<{
    cwd: string,
    dir: string,
    features: Array<string>,
    localesAndLanguages: Array<string>
  }> = [];

  // get translations from all deps (this is very dumb right now)
  const deps = await globby('node_modules/**/package.json');
  await Promise.all(deps.map(dep => readJsonAsync(dep).then(pkg => {
    if (pkg.ws && pkg.ws.i18n) {
      translatedModules.push({
        cwd: dirname(dep),
        dir: pkg.ws.i18n.dir || 'i18n',
        features: pkg.ws.i18n.features || [ '' ],
        localesAndLanguages: concatLanguages(pkg.ws.i18n.locales)
      });
    }
  })));

  translatedModules.push({
    cwd: process.cwd(),
    dir: i18n.dir,
    features: i18n.features || [ '' ],
    localesAndLanguages: concatLanguages(i18n.locales)
  });

  const readPromises: Promise<Translation>[] = [];
  translatedModules.forEach(translatedModule => translatedModule.features.forEach(feature => translatedModule.localesAndLanguages.forEach(localeOrLanguage => {
    readPromises.push(readTranslation(translatedModule.cwd, translatedModule.dir, localeOrLanguage, feature));
  })));
  const translations: Translation[] = await Promise.all(readPromises);

  const groupedTranslations: GroupedTranslation[] = i18n.locales.map(locale => ({
    locale,
    translations: translations.filter(translation => isMatchingLocaleOrLanguage(translation.locale, locale))
  }));

  const mergedTranslations: Translation[] = groupedTranslations.map(({ locale, translations }) => ({
    locale,
    data: translations.reverse().reduce((acc, translation) => Object.assign(acc, translation.data), {} as TranslationMap)
  }));

  const parsedTranslations: ParsedTranslation[] = mergedTranslations.map(translation => {
    const asts = {};
    Object.keys(translation.data).forEach(key => {
      const ast = parser.parse(translation.data[key]);
      asts[key] = ast;
    });
    return Object.assign({ asts }, translation);
  });

  await removeAsync(i18n.distDir);
  await Promise.all(parsedTranslations.map(parsedTranslation => writeTranslation(parsedTranslations[0], parsedTranslation)));
  await writeTranslationUnit(parsedTranslations[0]);

  if (project.ws.entryExtension !== 'js') {
    await writeDeclaration(parsedTranslations);
  }
};
