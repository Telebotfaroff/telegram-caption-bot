import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { Telegraf } from 'telegraf';

const appLogs: string[] = [];
function addLog(msg: string) {
  const timestamp = new Date().toLocaleTimeString();
  appLogs.unshift(`[${timestamp}] ${msg}`);
  if (appLogs.length > 150) appLogs.pop();
  console.log(msg);
}

// Global safety catchers to ensure the Express server never dies from background async errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  addLog(`Uncaught exception: ${err.message}`);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('Unhandled Rejection:', reason);
  addLog(`Unhandled rejection: ${reason?.message || reason}`);
});

// Config persistence
const CONFIG_FILE = path.join(process.cwd(), 'bot-config.json');

export interface BotConfig {
  batchCaptionEnabled: boolean;
  batchTimeWindowMs: number;
  captionPrefix: string;
  captionSuffix: string;
  dumpChannelId: string;
  dumpChannelEnabled: boolean;
}

let botConfig: BotConfig = {
  batchCaptionEnabled: true,
  batchTimeWindowMs: 2500,
  captionPrefix: '',
  captionSuffix: '',
  dumpChannelId: '',
  dumpChannelEnabled: false,
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      botConfig = { ...botConfig, ...parsed };
      console.log('Loaded bot configuration:', botConfig);
    }
  } catch (err: any) {
    console.error('Failed to load bot config:', err.message);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(botConfig, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('Failed to save bot config:', err.message);
  }
}

loadConfig();

// Telegram API rate-limit retry wrapper
async function telegramCallWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let retries = 3;
  while (retries > 0) {
    try {
      return await fn();
    } catch (err: any) {
      if (err.code === 429 && err.parameters?.retry_after) {
        const waitMs = err.parameters.retry_after * 1000;
        addLog(`Telegram API rate limit (429). Waiting ${waitMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs + 200));
        retries--;
      } else if (err.code === 429) {
        addLog(`Telegram API rate limit (429). Waiting 2s...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        retries--;
      } else {
        throw err;
      }
    }
  }
  throw new Error('Max retries exceeded for Telegram API call');
}

/**
 * Extracts and standardizes video codes (e.g. HMN-863, SSNI-999, FC2-PPV-1234567)
 * from text or captions.
 */
export function extractJavCode(text: string): string | null {
  if (!text) return null;

  // 1. FC2 / FC2-PPV pattern: FC2-PPV-1234567, FC2PPV-1234567, FC2-1234567, FC2 1234567
  const fc2Match = text.match(/(?:^|[^a-zA-Z0-9])FC2(?:[-_ ]?PPV)?[-_ ]?(\d{5,8})(?:[^a-zA-Z0-9]|$)/i);
  if (fc2Match) {
    return `FC2-PPV-${fc2Match[1]}`;
  }

  // 2. HEYZO pattern: HEYZO-1234, HEYZO 1234, HEYZO1234
  const heyzoMatch = text.match(/(?:^|[^a-zA-Z0-9])HEYZO[-_ ]?(\d{4})(?:[^a-zA-Z0-9]|$)/i);
  if (heyzoMatch) {
    return `HEYZO-${heyzoMatch[1]}`;
  }

  // 3. Uncensored date-id pattern (Caribbeancom, 1pondo, 10musume): e.g. 123456-789 or 123456_789
  const dateIdMatch = text.match(/(?:^|[^a-zA-Z0-9])(\d{6})[-_](\d{3})(?:[^a-zA-Z0-9]|$)/);
  if (dateIdMatch) {
    return `${dateIdMatch[1]}-${dateIdMatch[2]}`;
  }

  // 4. Tokyo-Hot pattern: n1234, cz123, k1234, kb1234
  const tokyoHotMatch = text.match(/(?:^|[^a-zA-Z0-9])(n|cz|k|kb)(\d{4})(?:[^a-zA-Z0-9]|$)/i);
  if (tokyoHotMatch) {
    return `${tokyoHotMatch[1].toLowerCase()}${tokyoHotMatch[2]}`;
  }

  // 5. Studio codes starting with 3 digits + 3-5 letters (e.g. 259LUXU-1234, 300MIUM-123)
  const numPrefixMatch = text.match(/(?:^|[^a-zA-Z0-9])(\d{3}[a-zA-Z]{3,5})[-_ ]?(\d{2,6})(?:[^a-zA-Z0-9]|$)/i);
  if (numPrefixMatch) {
    return `${numPrefixMatch[1].toUpperCase()}-${numPrefixMatch[2]}`;
  }

  // 6. Standard code pattern: 2 to 8 letters followed by 2 to 6 digits (e.g. HMN-863, SSNI-999, CAWD-012)
  const standardRegex = /(?:^|[^a-zA-Z0-9])([a-zA-Z]{2,8})[-_ ]?(\d{2,6})(?:[^a-zA-Z0-9]|$)/gi;
  const ignoredPrefixes = new Set([
    'HD', 'FHD', 'UHD', 'DVD', 'SD', 'WEB', 'RIP', 'AAC', 'FLAC', 'MP', 'PART',
    'VOL', 'DISC', 'DISK', 'CD', 'EP', 'FPS', 'GB', 'MB', 'KB', 'ISO',
    'HEVC', 'AVC', 'DTS', 'TRUEHD', 'REMUX', 'BLURAY', 'BDRIP', 'DVDRIP',
    'X264', 'X265', 'H264', 'H265'
  ]);

  let match: RegExpExecArray | null;
  while ((match = standardRegex.exec(text)) !== null) {
    const prefix = match[1].toUpperCase();
    const digits = match[2];

    // Filter out common false-positive tech tags
    if (ignoredPrefixes.has(prefix)) {
      continue;
    }

    return `${prefix}-${digits}`;
  }

  return null;
}

// Resend media directly with the new caption (used when copyMessage might be restricted)
async function resendMediaFallback(ctx: any, message: any, newCaption: string) {
  const chatId = ctx.chat.id;
  if (message.video) {
    return ctx.telegram.sendVideo(chatId, message.video.file_id, { caption: newCaption });
  }
  if (message.document) {
    return ctx.telegram.sendDocument(chatId, message.document.file_id, { caption: newCaption });
  }
  if (message.photo && message.photo.length > 0) {
    const largestPhoto = message.photo[message.photo.length - 1];
    return ctx.telegram.sendPhoto(chatId, largestPhoto.file_id, { caption: newCaption });
  }
  if (message.animation) {
    return ctx.telegram.sendAnimation(chatId, message.animation.file_id, { caption: newCaption });
  }
  if (message.audio) {
    return ctx.telegram.sendAudio(chatId, message.audio.file_id, { caption: newCaption });
  }
  return ctx.reply(newCaption);
}

// Automatically forwards/copies successfully captioned media to the designated Dump Channel
async function sendToDumpChannel(ctx: any, message: any, caption: string) {
  if (!botConfig.dumpChannelEnabled || !botConfig.dumpChannelId) return;

  const target = botConfig.dumpChannelId.trim();
  if (!target) return;

  // Prevent recursive dump loop if the message came from the dump channel itself
  const sourceChatId = String(ctx.chat?.id || '');
  const sourceUsername = (ctx.chat?.username || '').toLowerCase();
  const cleanTarget = target.replace(/^@/, '').toLowerCase();
  if (sourceChatId === target || (sourceUsername && sourceUsername === cleanTarget)) {
    return;
  }

  try {
    // 1. Try copyMessage directly to dump channel
    await telegramCallWithRetry(async () => {
      await ctx.telegram.copyMessage(target, ctx.chat.id, message.message_id, {
        caption,
      });
    });
    addLog(`[Dump Channel] Successfully archived file #${message.message_id} to ${target}`);
  } catch (err: any) {
    addLog(`[Dump Channel] copyMessage to ${target} failed (${err.message}). Trying media fallback...`);
    try {
      if (message.video) {
        await telegramCallWithRetry(() => ctx.telegram.sendVideo(target, message.video.file_id, { caption }));
      } else if (message.document) {
        await telegramCallWithRetry(() => ctx.telegram.sendDocument(target, message.document.file_id, { caption }));
      } else if (message.photo && message.photo.length > 0) {
        const largestPhoto = message.photo[message.photo.length - 1];
        await telegramCallWithRetry(() => ctx.telegram.sendPhoto(target, largestPhoto.file_id, { caption }));
      } else if (message.animation) {
        await telegramCallWithRetry(() => ctx.telegram.sendAnimation(target, message.animation.file_id, { caption }));
      } else if (message.audio) {
        await telegramCallWithRetry(() => ctx.telegram.sendAudio(target, message.audio.file_id, { caption }));
      }
      addLog(`[Dump Channel] Successfully archived file to ${target} via fallback`);
    } catch (fallbackErr: any) {
      addLog(`[Dump Channel] Failed to send media to dump channel ${target}: ${fallbackErr.message}`);
    }
  }
}

// Batch Forward Queue & Collector
interface BatchItem {
  ctx: any;
  message: any;
  captionText: string;
  rawFileName: string;
  detectedCode: string | null;
  isChannel: boolean;
}

interface BatchSession {
  key: string;
  chatId: string | number;
  isChannel: boolean;
  items: BatchItem[];
  detectedCode: string | null;
  firstTimestamp: number;
  timeoutHandle: NodeJS.Timeout | null;
}

const activeBatches = new Map<string, BatchSession>();

async function flushBatch(batchKey: string) {
  const session = activeBatches.get(batchKey);
  if (!session) return;
  activeBatches.delete(batchKey);

  const { items, chatId, isChannel } = session;
  if (items.length === 0) return;

  // 1. Find the code for this batch:
  // Check if any message in the batch contained a detected code
  let targetCode = session.detectedCode;
  if (!targetCode) {
    for (const item of items) {
      if (item.detectedCode) {
        targetCode = item.detectedCode;
        break;
      }
    }
  }

  if (!targetCode) {
    addLog(`[Batch] Received ${items.length} file(s) in chat ${chatId}, but no video code detected in batch. Skipping.`);
    return;
  }

  const finalCaption = `${botConfig.captionPrefix}${targetCode}${botConfig.captionSuffix}`;
  const totalFiles = items.length;
  const withOriginalCode = items.filter((it) => it.detectedCode !== null).length;
  const inheritedCount = totalFiles - withOriginalCode;

  addLog(
    `[Batch Forward] Processing ${totalFiles} file(s) for chat ${chatId}. Caption: "${finalCaption}". ` +
    `(${withOriginalCode} had code, ${inheritedCount} inherited caption)`
  );

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      if (isChannel && item.captionText !== undefined) {
        // In channels, try editing the post caption first
        try {
          await telegramCallWithRetry(async () => {
            await item.ctx.telegram.editMessageCaption(
              chatId,
              item.message.message_id,
              undefined,
              finalCaption
            );
          });
          addLog(`[Batch Forward] Updated channel post #${item.message.message_id} caption to "${finalCaption}" (${i + 1}/${totalFiles})`);
          
          // Also archive to Dump Channel if enabled
          await sendToDumpChannel(item.ctx, item.message, finalCaption);
          continue;
        } catch {
          // If editing caption is not permitted, fall through to resend
        }
      }

      // Resend media with finalCaption
      try {
        await telegramCallWithRetry(async () => {
          await item.ctx.telegram.copyMessage(chatId, chatId, item.message.message_id, {
            caption: finalCaption,
          });
        });
        addLog(`[Batch Forward] Resent file (${i + 1}/${totalFiles}) with caption "${finalCaption}"`);
      } catch (copyErr: any) {
        addLog(`copyMessage failed for file ${i + 1} (${copyErr.message}). Using fallback resender...`);
        await telegramCallWithRetry(() => resendMediaFallback(item.ctx, item.message, finalCaption));
        addLog(`[Batch Forward] Resent file (${i + 1}/${totalFiles}) via fallback with caption "${finalCaption}"`);
      }

      // Forward to Dump Channel if enabled
      await sendToDumpChannel(item.ctx, item.message, finalCaption);

      // Throttling between successive sends in a batch to avoid Telegram flood limits
      if (i < items.length - 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (err: any) {
      addLog(`[Batch Forward] Error resending file ${i + 1}: ${err.message}`);
    }
  }

  addLog(`[Batch Forward] Successfully completed batch of ${totalFiles} file(s) with caption "${finalCaption}"`);
}

function queueMediaMessage(
  ctx: any,
  message: any,
  captionText: string,
  rawFileName: string,
  detectedCode: string | null,
  isChannel: boolean
) {
  const chatId = ctx.chat.id;
  const isAlbum = Boolean(message.media_group_id);
  const isForward = Boolean(
    message.forward_origin ||
    message.forward_date ||
    message.forward_from_chat ||
    message.forward_from
  );

  // Group key: If album, group strictly by media_group_id; otherwise group by chat forward session
  const batchKey = isAlbum
    ? `album:${chatId}:${message.media_group_id}`
    : `chat:${chatId}:burst`;

  let session = activeBatches.get(batchKey);

  if (session) {
    // Add to existing batch
    session.items.push({ ctx, message, captionText, rawFileName, detectedCode, isChannel });
    if (detectedCode) {
      session.detectedCode = detectedCode;
    }

    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
    }

    // Debounce: if batch has been accumulating for < 5000ms, wait another batchTimeWindowMs
    const elapsed = Date.now() - session.firstTimestamp;
    const waitTime = elapsed > 5000 ? 200 : Math.min(botConfig.batchTimeWindowMs, 2500);
    session.timeoutHandle = setTimeout(() => flushBatch(batchKey), waitTime);
  } else {
    // New batch session
    const debounceWait = isForward || isAlbum ? botConfig.batchTimeWindowMs : 600;
    session = {
      key: batchKey,
      chatId,
      isChannel,
      items: [{ ctx, message, captionText, rawFileName, detectedCode, isChannel }],
      detectedCode,
      firstTimestamp: Date.now(),
      timeoutHandle: setTimeout(() => flushBatch(batchKey), debounceWait),
    };
    activeBatches.set(batchKey, session);
  }
}

// Global bot state tracking
let botStatus: 'idle' | 'running' | 'standby' | 'error' = 'idle';
let consecutive409Count = 0;
let triggerBotLaunch: (forced?: boolean) => Promise<void>;
let activeBotInstance: Telegraf | null = null;

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      botActive: !!process.env.TELEGRAM_BOT_TOKEN,
      botStatus,
    });
  });

  app.get('/api/logs', (req, res) => {
    res.json(appLogs);
  });

  // Config API: get current settings
  app.get('/api/config', (req, res) => {
    res.json(botConfig);
  });

  // Config API: update settings
  app.post('/api/config', (req, res) => {
    const {
      batchCaptionEnabled,
      batchTimeWindowMs,
      captionPrefix,
      captionSuffix,
      dumpChannelId,
      dumpChannelEnabled,
    } = req.body || {};

    if (typeof batchCaptionEnabled === 'boolean') {
      botConfig.batchCaptionEnabled = batchCaptionEnabled;
    }
    if (typeof batchTimeWindowMs === 'number' && batchTimeWindowMs >= 500 && batchTimeWindowMs <= 10000) {
      botConfig.batchTimeWindowMs = batchTimeWindowMs;
    }
    if (typeof captionPrefix === 'string') {
      botConfig.captionPrefix = captionPrefix;
    }
    if (typeof captionSuffix === 'string') {
      botConfig.captionSuffix = captionSuffix;
    }
    if (typeof dumpChannelId === 'string') {
      botConfig.dumpChannelId = dumpChannelId.trim();
    }
    if (typeof dumpChannelEnabled === 'boolean') {
      botConfig.dumpChannelEnabled = dumpChannelEnabled;
    }

    saveConfig();
    addLog(`[Config] Updated settings: batchCaption=${botConfig.batchCaptionEnabled}, dumpChannel="${botConfig.dumpChannelId}" (enabled=${botConfig.dumpChannelEnabled})`);
    res.json({ success: true, config: botConfig });
  });

  // Test Dump Channel connection by sending a verification ping
  app.post('/api/test-dump', async (req, res) => {
    const { channelId } = req.body || {};
    const target = (channelId || botConfig.dumpChannelId || '').trim();
    if (!target) {
      return res.status(400).json({ error: 'Please enter a Dump Channel username or ID (e.g. @channel or -1001234567890)' });
    }
    if (!activeBotInstance) {
      return res.status(400).json({ error: 'Telegram Bot is not connected yet' });
    }
    try {
      await activeBotInstance.telegram.sendMessage(
        target,
        `✅ Dump Channel Verified!\n\nThis channel is configured as the dump archive. All files captioned by the bot will be automatically sent here.`
      );
      addLog(`[Dump Channel] Test message successfully sent to ${target}`);
      res.json({ success: true, message: `Successfully sent test message to ${target}` });
    } catch (err: any) {
      addLog(`[Dump Channel] Test message failed to ${target}: ${err.message}`);
      res.status(400).json({ error: `Cannot post to ${target}: ${err.message}. Make sure the bot is an Admin in the channel with "Post Messages" permission.` });
    }
  });

  // Tester API endpoint to preview code detection from browser UI
  app.post('/api/test-code', (req, res) => {
    const { text } = req.body || {};
    const code = extractJavCode(text || '');
    res.json({ detected: !!code, code });
  });

  // Batch Simulator API endpoint for the frontend interactive tester
  app.post('/api/test-batch', (req, res) => {
    const { files } = req.body || {};
    const fileList: Array<{ name: string; caption?: string }> = Array.isArray(files) ? files : [];

    let detectedCode: string | null = null;
    for (const f of fileList) {
      const code = extractJavCode(f.caption || f.name || '');
      if (code) {
        detectedCode = code;
        break;
      }
    }

    const finalCaption = detectedCode
      ? `${botConfig.captionPrefix}${detectedCode}${botConfig.captionSuffix}`
      : null;

    const results = fileList.map((f, index) => {
      const selfCode = extractJavCode(f.caption || f.name || '');
      return {
        index: index + 1,
        name: f.name,
        originalCaption: f.caption || '',
        hadOriginalCode: !!selfCode,
        appliedCaption: finalCaption,
        status: finalCaption ? 'caption_applied' : 'no_code_detected',
      };
    });

    res.json({
      success: true,
      batchCount: fileList.length,
      detectedCode,
      finalCaption,
      batchCaptionEnabled: botConfig.batchCaptionEnabled,
      results,
    });
  });

  // Reclaim / Reconnect bot polling endpoint
  app.post('/api/reclaim-bot', async (req, res) => {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return res.status(400).json({ error: 'No bot token configured' });
    }
    addLog('User requested manual bot reconnect / take over polling');
    if (triggerBotLaunch) {
      await triggerBotLaunch(true);
    }
    res.json({ success: true, botStatus });
  });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (botToken) {
    const bot = new Telegraf(botToken);
    activeBotInstance = bot;
    let isShuttingDown = false;
    let launchInProgress = false;

    bot.catch((err: any, ctx: any) => {
      console.error(`Telegram update error for ${ctx?.updateType}:`, err);
      addLog(`Telegram bot error: ${err?.message || 'Unknown error'}`);
    });

    bot.start((ctx) => {
      addLog('Received /start command');
      return telegramCallWithRetry(() =>
        ctx.reply(
          `👋 Welcome!\n\n` +
          `• 🎬 Send or forward media with a caption containing a video code (e.g. HMN-863).\n` +
          `• 📦 Batch Forward Mode: Forward 10 files at once where only 1 file has the caption, and I will automatically apply the caption to ALL 10 files!\n` +
          `• 📢 Dump Channel: Configure a channel where all successfully captioned files are sent automatically!\n` +
          `• 📢 In channels, add me as an Admin to automatically format post captions!\n\n` +
          `Commands (tap to run):\n` +
          `• /batch - Check batch forward settings\n` +
          `• /batch_on (or /batch-on) - Enable batch caption\n` +
          `• /batch_off (or /batch-off) - Disable batch caption\n` +
          `• /dump - Check dump channel status\n` +
          `• /setdump <@channel> - Set dump channel\n` +
          `• /cleardump - Disable dump channel\n` +
          `• /help - Full guide`
        )
      ).catch((err) => addLog(`Start reply error: ${err.message}`));
    });

    bot.help((ctx) => {
      addLog('Received /help command');
      return telegramCallWithRetry(() =>
        ctx.reply(
          `📖 Instructions:\n\n` +
          `1. Batch Forwarding (10 Files at Once):\n` +
          `   When you forward 10 files together and only 1 file has the code in its caption, the bot detects the code and applies it to all 10 files!\n\n` +
          `2. Dump Channel Archive:\n` +
          `   Create a private or public Telegram channel, add @translatefaroffbot as an Admin with "Post Messages" permission, then run:\n` +
          `   /setdump @your_channel (or channel ID -100xxx)\n` +
          `   All captioned files will automatically be backed up to this channel!\n\n` +
          `3. Commands (single-click without space):\n` +
          `   • /batch - Batch status & options\n` +
          `   • /batch_on or /batch-on - Turn ON batch captioning\n` +
          `   • /batch_off or /batch-off - Turn OFF batch captioning\n` +
          `   • /dump - View dump channel status\n` +
          `   • /setdump <@channel or -100id> - Connect dump channel\n` +
          `   • /cleardump - Disable dump channel`
        )
      ).catch((err) => addLog(`Help reply error: ${err.message}`));
    });

    const enableBatchMode = async (ctx: any) => {
      botConfig.batchCaptionEnabled = true;
      saveConfig();
      addLog(`User enabled batchCaption`);
      return ctx.reply(
        `✅ Batch Forward Captioning is now ENABLED!\n\n` +
        `When you forward multiple files (e.g. 10 files where only 1 has a caption), all files will automatically receive that caption.\n\n` +
        `To disable anytime, tap: /batch_off or /batch-off`
      );
    };

    const disableBatchMode = async (ctx: any) => {
      botConfig.batchCaptionEnabled = false;
      saveConfig();
      addLog(`User disabled batchCaption`);
      return ctx.reply(
        `❌ Batch Forward Captioning is now DISABLED.\n\n` +
        `Files without their own caption will no longer inherit batch captions.\n\n` +
        `To re-enable anytime, tap: /batch_on or /batch-on`
      );
    };

    // Direct no-space commands (supported by all Telegram clients)
    bot.command(['batch_on', 'batchon'], enableBatchMode);
    bot.command(['batch_off', 'batchoff'], disableBatchMode);

    // Regex listener for hyphenated variants (/batch-off, /batch-on, /batch off, /batch on)
    bot.hears(/^\/batch[-_ ]?(on|enable|1)(@\w+)?$/i, enableBatchMode);
    bot.hears(/^\/batch[-_ ]?(off|disable|0)(@\w+)?$/i, disableBatchMode);

    // /batch status command
    bot.command('batch', async (ctx) => {
      const text = (ctx.message?.text || '').trim();

      // Check if user typed /batch on, /batch off, /batch-off, etc.
      if (/^\/batch[-_ ]?(on|enable|1)(@\w+)?$/i.test(text)) {
        return enableBatchMode(ctx);
      }
      if (/^\/batch[-_ ]?(off|disable|0)(@\w+)?$/i.test(text)) {
        return disableBatchMode(ctx);
      }

      const parts = text.split(/\s+/);
      const sub = (parts[1] || '').replace(/^[-_]/, '').toLowerCase();
      if (sub === 'on' || sub === 'enable' || sub === '1') {
        return enableBatchMode(ctx);
      }
      if (sub === 'off' || sub === 'disable' || sub === '0') {
        return disableBatchMode(ctx);
      }

      return ctx.reply(
        `📦 Batch Forward Caption Settings:\n\n` +
        `• Status: ${botConfig.batchCaptionEnabled ? '✅ ENABLED' : '❌ DISABLED'}\n` +
        `• Window: ${botConfig.batchTimeWindowMs / 1000}s debounce\n` +
        `• Dump Channel: ${botConfig.dumpChannelEnabled && botConfig.dumpChannelId ? `✅ Active (${botConfig.dumpChannelId})` : '❌ Disabled'}\n\n` +
        `💡 Tap command to change:\n` +
        `• /batch_on or /batch-on — Turn ON\n` +
        `• /batch_off or /batch-off — Turn OFF\n` +
        `• /dump — View dump channel settings`
      );
    });

    // Dump Channel command: /setdump <@channel or -100id>
    const handleSetDump = async (ctx: any) => {
      const text = (ctx.message?.text || '').trim();
      const parts = text.split(/\s+/);
      const target = (parts[1] || '').trim();
      if (!target) {
        return ctx.reply(
          `Please provide the Dump Channel @username or ID.\n\n` +
          `Example:\n` +
          `• /setdump @my_dump_channel\n` +
          `• /setdump -1001234567890\n\n` +
          `Note: The bot must be an Admin in that channel with "Post Messages" permission.`
        );
      }
      botConfig.dumpChannelId = target;
      botConfig.dumpChannelEnabled = true;
      saveConfig();

      try {
        await ctx.telegram.sendMessage(
          target,
          `✅ Dump Channel Activated!\n\nAll successfully captioned files from this bot will automatically be archived here.`
        );
        addLog(`[Dump Channel] Verified and activated dump channel ${target}`);
        return ctx.reply(`✅ Dump Channel successfully set to ${target} and verified!\n\nAll captioned files will now automatically be forwarded there.`);
      } catch (err: any) {
        addLog(`[Dump Channel] Configured ${target} but verification test failed: ${err.message}`);
        return ctx.reply(
          `⚠️ Dump Channel saved as ${target}, but sending a test message failed (${err.message}).\n\n` +
          `Please make sure:\n` +
          `1. You added @translatefaroffbot to ${target}\n` +
          `2. You gave the bot "Post Messages" administrator permission.`
        );
      }
    };

    bot.command(['setdump', 'set_dump'], handleSetDump);

    // Dump Channel command: /cleardump
    const handleClearDump = async (ctx: any) => {
      botConfig.dumpChannelEnabled = false;
      botConfig.dumpChannelId = '';
      saveConfig();
      addLog(`User disabled dump channel`);
      return ctx.reply(`🧹 Dump Channel has been cleared and disabled.`);
    };

    bot.command(['cleardump', 'clear_dump', 'removedump'], handleClearDump);

    // Dump Channel command: /dump
    bot.command('dump', async (ctx) => {
      return ctx.reply(
        `📦 Dump Channel Status:\n\n` +
        `• Enabled: ${botConfig.dumpChannelEnabled ? '✅ YES' : '❌ NO'}\n` +
        `• Target: ${botConfig.dumpChannelId ? botConfig.dumpChannelId : 'None'}\n\n` +
        `💡 Commands:\n` +
        `• /setdump <@channel or -100id> — Set & verify dump channel\n` +
        `• /cleardump — Disable dump channel`
      );
    });

    bot.use((ctx, next) => {
      botStatus = 'running';
      consecutive409Count = 0;
      addLog(`Received update type: ${ctx.updateType}`);
      return next();
    });

    const handleMessage = async (ctx: any) => {
      try {
        const message = ctx.message || ctx.channelPost;
        if (!message) {
          addLog('Update skipped: no message or channelPost found');
          return;
        }

        const isChannel = ctx.chat?.type === 'channel';
        const hasMedia = Boolean(
          message.caption !== undefined ||
          message.document ||
          message.video ||
          message.photo ||
          message.animation ||
          message.audio
        );

        const captionText = message.caption || '';
        const rawFileName = message.document?.file_name || message.video?.file_name || '';
        const textContent = message.text || '';
        const searchSource = captionText || rawFileName || textContent;

        // Skip bot commands in text messages
        if (textContent.startsWith('/')) {
          return;
        }

        const detectedJavCode = extractJavCode(searchSource);

        if (hasMedia) {
          // If batch captioning is enabled, route to batch collector
          if (botConfig.batchCaptionEnabled) {
            queueMediaMessage(
              ctx,
              message,
              captionText,
              rawFileName,
              detectedJavCode,
              isChannel
            );
            return;
          }

          // Batch mode is disabled: process individual file
          if (!detectedJavCode) {
            addLog(`No code found in individual file ${message.message_id}. Skipping.`);
            return;
          }

          addLog(`[Single File] Detected code: "${detectedJavCode}" from message ${message.message_id}`);

          const finalCaption = `${botConfig.captionPrefix}${detectedJavCode}${botConfig.captionSuffix}`;

          if (isChannel) {
            if (message.caption !== undefined) {
              try {
                await telegramCallWithRetry(async () => {
                  await ctx.telegram.editMessageCaption(
                    ctx.chat.id,
                    message.message_id,
                    undefined,
                    finalCaption
                  );
                });
                addLog(`[Single File] Updated channel caption to: "${finalCaption}"`);
                await sendToDumpChannel(ctx, message, finalCaption);
                return;
              } catch {
                // Fall through to copyMessage
              }
            }
            try {
              await telegramCallWithRetry(async () => {
                await ctx.telegram.copyMessage(ctx.chat.id, ctx.chat.id, message.message_id, {
                  caption: finalCaption,
                });
              });
              addLog(`[Single File] Resent channel media with caption: "${finalCaption}"`);
            } catch (err: any) {
              await telegramCallWithRetry(() => resendMediaFallback(ctx, message, finalCaption));
            }
            await sendToDumpChannel(ctx, message, finalCaption);
          } else {
            try {
              await telegramCallWithRetry(async () => {
                await ctx.telegram.copyMessage(ctx.chat.id, ctx.chat.id, message.message_id, {
                  caption: finalCaption,
                });
              });
              addLog(`[Single File] Resent media with code caption: "${finalCaption}"`);
            } catch (copyErr: any) {
              await telegramCallWithRetry(() => resendMediaFallback(ctx, message, finalCaption));
            }
            await sendToDumpChannel(ctx, message, finalCaption);
          }
          return;
        }

        // Text-only message with code
        if (detectedJavCode) {
          const finalCaption = `${botConfig.captionPrefix}${detectedJavCode}${botConfig.captionSuffix}`;
          await telegramCallWithRetry(async () => {
            await ctx.reply(finalCaption, {
              reply_parameters: { message_id: message.message_id },
            });
          });
          addLog(`[Text Message] Replied with detected code: "${finalCaption}"`);
        }
      } catch (err: any) {
        console.error('Error in message handler:', err);
        addLog(`Handler error: ${err.message || 'Unknown'}`);
      }
    };

    bot.on('message', handleMessage);
    bot.on('channel_post', handleMessage);

    const cleanupAndExit = () => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      try {
        bot.stop();
      } catch {}
    };

    process.once('SIGINT', cleanupAndExit);
    process.once('SIGTERM', cleanupAndExit);

    // Launch sequence with 409 conflict prevention and exponential backoff
    const launchBot = async (forced = false) => {
      if (launchInProgress) return;
      launchInProgress = true;

      if (forced) {
        consecutive409Count = 0;
        botStatus = 'idle';
        addLog('Forced reset of polling requested. Reconnecting...');
      }

      try {
        bot.stop();
      } catch {}

      try {
        const me = await bot.telegram.getMe();
        botStatus = 'running';
        consecutive409Count = 0;
        addLog(`Bot connected as @${me.username} and listening for forwarded files`);
      } catch (err: any) {
        console.error('getMe error:', err);
      }

      bot
        .launch({ dropPendingUpdates: true })
        .then(() => {
          addLog('Bot polling stopped cleanly.');
          if (!isShuttingDown) {
            botStatus = 'idle';
          }
        })
        .catch((err: any) => {
          if (err.code === 409) {
            consecutive409Count++;
            if (consecutive409Count >= 3) {
              botStatus = 'standby';
              addLog('⚠️ Another instance is actively using this token. Standby mode active. Use "Take Over Polling" in dashboard when ready.');
              return;
            }

            const delayMs = Math.min(12000 * Math.pow(2, consecutive409Count - 1), 60000);
            addLog(`409 Conflict: previous connection session draining. Retrying in ${delayMs / 1000}s (${consecutive409Count}/3)...`);
            setTimeout(() => {
              if (!isShuttingDown && botStatus !== 'standby') {
                launchBot();
              }
            }, delayMs);
          } else {
            botStatus = 'error';
            console.error('Bot launch error:', err);
            addLog(`Bot launch error: ${err.message || 'Unknown error'}`);
          }
        })
        .finally(() => {
          launchInProgress = false;
        });
    };

    triggerBotLaunch = launchBot;
    launchBot();
  } else {
    console.warn('TELEGRAM_BOT_TOKEN not found! Bot will not start.');
    addLog('Warning: TELEGRAM_BOT_TOKEN missing. Bot is inactive.');
  }

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    // Mount Vite dev middlewares
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    addLog(`Server initialized on port ${PORT}`);
  });
}

startServer();
