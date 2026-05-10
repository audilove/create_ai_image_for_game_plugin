'use strict';

const texts = require('../texts');
const kb = require('../keyboards');
const { safeEdit, safeAnswerCb } = require('../util');

function register(bot, deps) {
  const { sessions } = deps;

  async function showMain(ctx, asReply = false) {
    sessions.reset(ctx.from.id);
    const extra = { parse_mode: 'HTML', ...kb.mainMenu() };
    if (asReply) {
      await ctx.reply(texts.greeting, extra);
    } else {
      await safeEdit(ctx, texts.greeting, extra);
    }
  }

  bot.start(async (ctx) => {
    sessions.reset(ctx.from.id);
    await ctx.reply(texts.greeting, { parse_mode: 'HTML', ...kb.mainMenu() });
  });

  bot.command('menu', async (ctx) => {
    sessions.reset(ctx.from.id);
    await ctx.reply(texts.greeting, { parse_mode: 'HTML', ...kb.mainMenu() });
  });

  bot.action('menu:main', async (ctx) => {
    await safeAnswerCb(ctx);
    await showMain(ctx, false);
  });

  bot.action('menu:help', async (ctx) => {
    await safeAnswerCb(ctx);
    const help =
      '<b>Помощь</b>\n\n' +
      '1. Создайте стиль в «🎨 Мои стили» — загрузите до 10 эталонных картинок (палитра, рендеринг, материалы).\n' +
      '2. (опционально) Создайте правило в «📜 Правила для генерации» — текстовое описание мира/требований.\n' +
      '3. «📦 Сгенерировать ассет пак» — опишите продукт → правило или пропуск → один лист 16:9 со множеством UI-элементов для референса; ниже можно «Создать стиль» по этому листу или «Перегенерировать» его.\n' +
      '4. Жмите «🖼 Создать изображение» и пройдите шаги: запрос → правило → стиль → тип (есть режим «Без типа» с выбором формата из всех соотношений) → при необходимости фон/ориентация для фона.\n' +
      '5. «📐 Разрешение» — 0.5× / 1× / 2× для параметра модели (<code>image_size</code> в API), чтобы по возможности не платить за лишнее.\n' +
      '6. Или «🛠 Загрузить и изменить»: исходник → опционально картинка для встройки → описание изменений → правило.\n' +
      '7. «✂️ Удалить фон» — только загрузите картинку: получите PNG с прозрачностью и ссылку на WebP.\n\n' +
      '8. «🧩 Разобрать макет [BETA]» — скриншот UI/UX: распознавание, список, подтверждение, затем генерация с отправкой каждого ассета по готовности.\n' +
      '9. «🤖 Модели» — свои модели OpenRouter для картинок: добавить slug, сделать активной, удалить или вернуться к модели сервера.\n\n' +
      'Под обычным результатом: «Изменить», «Объединить с картинкой», «Перегенерировать», «Генерировать новое». Под листом ассет-пака: «Создать стиль», «Перегенерировать».';
    await safeEdit(ctx, help, { parse_mode: 'HTML', ...kb.backToMenu() });
  });

  return { showMain };
}

module.exports = register;
