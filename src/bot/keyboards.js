'use strict';

const { Markup } = require('telegraf');
const texts = require('./texts');
const { TYPE_LABELS } = require('./util');

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(texts.mainMenu.create, 'menu:create')],
    [Markup.button.callback(texts.mainMenu.uploadEdit, 'menu:upload_edit')],
    [Markup.button.callback(texts.mainMenu.detectLayout, 'menu:detect_layout')],
    [Markup.button.callback(texts.mainMenu.styles, 'menu:styles')],
    [Markup.button.callback(texts.mainMenu.rules, 'menu:rules')],
    [Markup.button.callback(texts.mainMenu.help, 'menu:help')],
  ]);
}

function backToMenu(extra = []) {
  return Markup.inlineKeyboard([
    ...extra,
    [Markup.button.callback(texts.back, 'menu:main')],
  ]);
}

function stylesList(styles) {
  const rows = styles.map((s) => [
    Markup.button.callback(texts.styles.open(s.name, s.files.length), `style:open:${s.id}`),
  ]);
  rows.push([Markup.button.callback(texts.styles.create, 'style:new')]);
  rows.push([Markup.button.callback(texts.back, 'menu:main')]);
  return Markup.inlineKeyboard(rows);
}

function styleDetail(styleId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(texts.styles.showRefsBtn, `style:show:${styleId}`)],
    [Markup.button.callback(texts.styles.deleteBtn, `style:del:${styleId}`)],
    [Markup.button.callback(texts.back, 'menu:styles')],
  ]);
}

function styleNewProgress(count) {
  const rows = [];
  if (count > 0) rows.push([Markup.button.callback(texts.styles.saveBtn, 'style:save')]);
  rows.push([Markup.button.callback(texts.cancel, 'menu:styles')]);
  return Markup.inlineKeyboard(rows);
}

function rulesList(rules) {
  const rows = rules.map((r) => [
    Markup.button.callback(r.name, `rule:open:${r.id}`),
  ]);
  rows.push([Markup.button.callback(texts.rules.create, 'rule:new')]);
  rows.push([Markup.button.callback(texts.back, 'menu:main')]);
  return Markup.inlineKeyboard(rows);
}

function ruleDetail(ruleId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(texts.rules.deleteBtn, `rule:del:${ruleId}`)],
    [Markup.button.callback(texts.back, 'menu:rules')],
  ]);
}

function cancelOnly() {
  return Markup.inlineKeyboard([[Markup.button.callback(texts.cancel, 'wiz:cancel')]]);
}

function pickContext(rules, callbackPrefix) {
  const rows = rules.map((r) => [
    Markup.button.callback(r.name, `${callbackPrefix}:${r.id}`),
  ]);
  rows.push([Markup.button.callback(texts.skip, `${callbackPrefix}:none`)]);
  rows.push([Markup.button.callback(texts.cancel, 'wiz:cancel')]);
  return Markup.inlineKeyboard(rows);
}

function pickStyle(styles, callbackPrefix) {
  const rows = styles.map((s) => [
    Markup.button.callback(`${s.name} (${s.files.length})`, `${callbackPrefix}:${s.id}`),
  ]);
  rows.push([Markup.button.callback(texts.wizard.styleNone, `${callbackPrefix}:none`)]);
  rows.push([Markup.button.callback(texts.cancel, 'wiz:cancel')]);
  return Markup.inlineKeyboard(rows);
}

function pickType(callbackPrefix) {
  const rows = [];
  const entries = Object.entries(TYPE_LABELS);
  for (let i = 0; i < entries.length; i += 2) {
    const a = entries[i];
    const b = entries[i + 1];
    const row = [Markup.button.callback(a[1], `${callbackPrefix}:${a[0]}`)];
    if (b) row.push(Markup.button.callback(b[1], `${callbackPrefix}:${b[0]}`));
    rows.push(row);
  }
  rows.push([Markup.button.callback(texts.cancel, 'wiz:cancel')]);
  return Markup.inlineKeyboard(rows);
}

function pickBackground() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(texts.wizard.bgYes, 'wiz:bg:no')],
    [Markup.button.callback(texts.wizard.bgNo, 'wiz:bg:yes')],
    [Markup.button.callback(texts.cancel, 'wiz:cancel')],
  ]);
}

function pickAspectRatio() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(texts.wizard.ratio16x9, 'wiz:ratio:16/9')],
    [Markup.button.callback(texts.wizard.ratio9x16, 'wiz:ratio:9/16')],
    [Markup.button.callback(texts.cancel, 'wiz:cancel')],
  ]);
}

function confirmGenerate() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(texts.wizard.confirmBtn, 'wiz:go')],
    [Markup.button.callback(texts.cancel, 'wiz:cancel')],
  ]);
}

function confirmLayoutDraft(draftId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(texts.postActions.layoutConfirmGenerate, `wiz:layout_go:${draftId}`)],
    [Markup.button.callback(texts.postActions.layoutCancelDraft, `wiz:layout_cancel:${draftId}`)],
  ]);
}

function uploadEditAddonSkip() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(texts.skip, 'wiz:upload_edit_addon_skip')],
    [Markup.button.callback(texts.cancel, 'wiz:cancel')],
  ]);
}

function postActions(resultId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(texts.postActions.edit, `act:edit:${resultId}`),
      Markup.button.callback(texts.postActions.combine, `act:combine:${resultId}`),
    ],
    [
      Markup.button.callback(texts.postActions.regenerate, `act:regen:${resultId}`),
      Markup.button.callback(texts.postActions.newImage, `act:new`),
    ],
  ]);
}

module.exports = {
  mainMenu,
  backToMenu,
  stylesList,
  styleDetail,
  styleNewProgress,
  rulesList,
  ruleDetail,
  cancelOnly,
  pickContext,
  pickStyle,
  pickType,
  pickAspectRatio,
  pickBackground,
  confirmGenerate,
  confirmLayoutDraft,
  uploadEditAddonSkip,
  postActions,
};
