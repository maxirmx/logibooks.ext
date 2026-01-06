# logibooks.ext

Chrome extension to support documentation generator

A Chrome Manifest V3 extension that:
- navigates to URLs from a server-controlled job queue,
- asks the user to select a rectangle in the visible viewport,
- captures and crops the selected area,
- uploads the resulting image back to the server,
- repeats until an end marker is received.

The repository includes a **local simulation server** for development and testing.

---

## Components

### 1. Chrome Extension (`/ext`)
- Manifest V3
- Visible-area capture using `chrome.tabs.captureVisibleTab`
- User-driven rectangle selection (drag overlay)
- Cropping via `OffscreenCanvas`
- Upload via `fetch` + `multipart/form-data`

### 2. Simulation Server (`/sim-server`)
- Node.js + Express
- Serves a queue of URLs from an allow-list
- Accepts uploaded screenshots
- Stores images and metadata locally

---

## Prerequisites

- Chrome (latest stable)
- Node.js ≥ 18

---

## Running the simulation server

```bash
cd sim-server
npm install
 # Logibooks — Techdoc helper (обновлённый)

 Этот репозиторий содержит расширение браузера, которое помогает делать скриншоты выбранной области страницы и загружать их на целевой endpoint.

 **Коротко:**
 - UI и интеграция со страницей реализованы в content script.
 - Фоновые задачи (навигация вкладки, делать снимок экрана, загрузка) выполняет service worker (`ext/sw.js`).

 ## Ключевые файлы
 - Файлы расширения: [ext/manifest.json](ext/manifest.json)
 - UI / взаимодействие со страницей: [ext/ext/content.js](ext/ext/content.js#L1)
 - Фон (service worker): [ext/ext/sw.js](ext/ext/sw.js#L1)

 ## Архитектура
 - `content.js` отвечает только за DOM/UI (панель, overlay выбора области, кнопки Сохранить/Отменить). Он не содержит бизнес-логики загрузки или доступа к API расширения.
 - `sw.js` (service worker) — единственный источник правды для состояния рабочего процесса (переход, ожидание выбора, загрузка). Он отправляет команды `SHOW_UI`, `HIDE_UI` и `SHOW_ERROR` контент-скрипту.

 ## Почему service worker обязателен
 - API вроде `chrome.tabs.captureVisibleTab`, `chrome.tabs.update` и другие доступны только в фоновом контексте расширения. Их нельзя выполнять из content script.

 ## Установка (локально, developer mode)
 1. Откройте Chromium/Chrome/Edge.
 2. Откройте `chrome://extensions` (или `edge://extensions`).
 3. Включите "Режим разработчика".
 4. Нажмите "Загрузить распакованное расширение" и укажите папку `ext` (путь к папке с `manifest.json`).

 ## Быстрая проверка
 - После загрузки нажмите на иконку расширения или используйте механизм активации со страницы (если есть) — UI появится и предложит выбрать область.

 ## Команды для разработки
 (в проекте нет сборщика по умолчанию — файлы уже JS, просто редактируйте в `ext/ext/`)

 - Запуск (если у вас был локальный симулятор API — `sim-server`):

 ```bash
 # Если нужен dev-сервер (опционально)
 cd sim-server
 npm install
 npm start
 ```

 - Перезагрузить расширение (после правок):

 ```bash
 # В Chrome: откройте chrome://extensions и нажмите Reload напротив расширения
 ```

