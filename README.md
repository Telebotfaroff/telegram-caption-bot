# Telegram Caption & Dump Channel Bot

A Telegram bot and management dashboard built with Node.js, Telegraf, Express, React, and Tailwind CSS. The bot automatically detects video codes (e.g. `HMN-863`, `MIDE-123`, `IPX-500`), formats and applies clean captions to files, propagates captions across entire forwarded batches of media, and backs up every successfully captioned post to a designated Dump Channel.

---

## 🚀 Key Features

### 1. Automatic Video Code Extraction & Clean Captioning
- Automatically identifies video codes and serials from forwarded posts, channel messages, filenames, or text messages.
- Formats captions with optional custom prefix and suffix.

### 2. Batch Forward Caption Propagation
- When forwarding bursts of media (e.g., 10 video files at once where only the first file has a caption and 9 have none), the bot detects the code from the captioned file and propagates the caption to **all 10 files** within the batch.
- Supports both Telegram Albums (`media_group_id`) and rapid individual forward bursts within a configurable time window (1.5s – 4.0s).

### 3. Dump Channel Auto-Archival
- Designate a private or public Telegram channel (e.g., `@MyDumpChannel` or `-1001234567890`) where the bot automatically forwards/copies all successfully captioned posts.
- Configurable via web dashboard or Telegram commands (`/dump`, `/dump <channel_id>`, `/dump_off`).
- Built-in permission check and test message tool.

### 4. Single-Tap Telegram Commands (No Spaces)
Compliant with Telegram command specifications for instant one-click execution:
- `/start` — Welcome message and instructions.
- `/help` — Detailed command guide.
- `/batch` — View current batch forward mode and collection window.
- `/batch-on` or `/batch_on` — Turn ON batch caption propagation.
- `/batch-off` or `/batch_off` — Turn OFF batch caption propagation.
- `/dump` — View Dump Channel settings.
- `/dump <channel_id>` — Set destination Dump Channel.
- `/dump_off` — Turn OFF Dump Channel forwarding.

### 5. Web Control Dashboard
- Real-time bot status & configuration management.
- Dump Channel test tool to verify bot permissions before live use.
- Interactive 10-File Batch Forward Simulator to preview how caption propagation works.
- Activity logs stream.

---

## 🛠️ Tech Stack
- **Backend:** Node.js, Express, Telegraf (Telegram Bot API)
- **Frontend:** React 19, Vite, Tailwind CSS, Lucide Icons, Motion
- **Language:** TypeScript

---

## 📦 Installation & Setup

### Prerequisites
- Node.js (v18 or higher recommended)
- A Telegram Bot Token from [@BotFather](https://t.me/BotFather)

### 1. Clone the repository
```bash
git clone https://github.com/Telebotfaroff/telegram-caption-bot.git
cd telegram-caption-bot
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your bot token:
```env
TELEGRAM_BOT_TOKEN="your_bot_token_from_botfather"
PORT=3000
```

### 4. Run the Application
Development mode:
```bash
npm run dev
```

Build for production:
```bash
npm run build
npm start
```

---

## 📄 License
MIT License. Free to use and modify.
