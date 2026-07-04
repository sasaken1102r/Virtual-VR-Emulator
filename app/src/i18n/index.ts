import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import zh from './locales/zh.json';

/** 対応言語の一覧(設定画面のセレクトに使う) */
export const SUPPORTED_LANGUAGES = [
  { id: 'ja', label: '日本語' },
  { id: 'en', label: 'English' },
  { id: 'zh', label: '简体中文' },
  { id: 'ko', label: '한국어' },
] as const;

/**
 * OSの言語設定から対応言語を推定する。
 * @returns {string} 言語ID (ja/en/zh/ko)
 */
export const detectSystemLanguage = (): string => {
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith('ja')) return 'ja';
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('ko')) return 'ko';
  return 'en';
};

void i18n.use(initReactI18next).init({
  resources: {
    ja: { translation: ja },
    en: { translation: en },
    zh: { translation: zh },
    ko: { translation: ko },
  },
  lng: detectSystemLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// html要素のlang属性を言語に追従させる(CSSのlang別フォントスタック切替に使う)
i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.language;

export default i18n;
