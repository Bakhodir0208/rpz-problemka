/**
 * GOOGLE APPS SCRIPT ДЛЯ ИНТЕГРАЦИИ СКЛАДСКОГО ПРИЛОЖЕНИЯ
 * 
 * Инструкция по установке:
 * 1. В вашей Google Таблице выберите: Расширения -> Apps Script.
 * 2. Удалите стандартный код и вставьте этот файл целиком.
 * 3. Нажмите кнопку «Сохранить» (дискета).
 * 4. Нажмите «Начать развертывание» -> «Новое развертывание».
 * 5. Нажмите на шестеренку (Выберите тип) -> «Веб-приложение».
 * 6. Настройки:
 *    - Описание: Складской проблемный отдел API
 *    - Запуск от имени: Вы (ваш Google аккаунт)
 *    - Кто имеет доступ: Все (Anyone)
 * 7. Нажмите «Развернуть». При первом запуске Google попросит предоставить разрешения (нажмите Advanced -> Go to ... (unsafe) и подтвердите).
 * 8. Скопируйте «URL веб-приложения» и вставьте его в настройки веб-приложения (клик по ⚠️ логотипу).
 * 9. После развертывания запустите один раз функцию `setupSheet` вручную в редакторе скриптов, чтобы создать структуру листов и тестовые данные!
 */

// Точка входа для GET-запросов (чтение конфигурации и истории)
function doGet(e) {
  return handleRequest(e);
}

// Точка входа для POST-запросов (авторизация и запись логов)
function doPost(e) {
  return handleRequest(e);
}

// Универсальный обработчик запросов с поддержкой CORS
function handleRequest(e) {
  var parameter = e.parameter;
  var action = parameter.action;
  var response = { success: false, message: "Действие не указано" };

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Автоматическая инициализация структуры при первом запросе, если листов нет
    autoSetupIfNeeded(ss);

    if (action === "login") {
      var employeeId = parameter.employeeId;
      var empSheet = ss.getSheetByName("Employees");
      var empData = empSheet.getDataRange().getValues();

      var foundUser = null;
      for (var i = 1; i < empData.length; i++) {
        if (String(empData[i][0]).trim() === String(employeeId).trim()) {
          foundUser = {
            id: empData[i][0],
            name: empData[i][1],
            role: "Оператор",
            shift: empData[i][2] || "" // Смена из колонки C (индекс 2)
          };
          break;
        }
      }

      if (foundUser) {
        response = {
          success: true,
          name: foundUser.name,
          role: foundUser.role,
          shift: foundUser.shift
        };
      } else {
        response = { success: false, message: "Сотрудник с ID " + employeeId + " не найден в базе" };
      }

    } else if (action === "getConfig") {
      var configSheet = ss.getSheetByName("Config");
      var configData = configSheet.getDataRange().getValues();

      var problems = [];
      var actions = [];

      for (var i = 1; i < configData.length; i++) {
        if (configData[i][0]) problems.push(configData[i][0]);
        if (configData[i][1]) actions.push(configData[i][1]);
      }

      response = {
        success: true,
        problems: problems,
        actions: actions
      };

    } else if (action === "addRecord") {
      var logSheet = ss.getSheetByName("Log");

      var timestamp = new Date();
      var dateStr = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "dd.MM.yyyy");
      var timeStr = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "HH:mm:ss");

      var hour = Number(Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "H"));
      var dayNight = (hour >= 9 && hour < 21) ? "День" : "Ночь";

      logSheet.appendRow([
        dateStr,                       // A: Дата операции
        timeStr,                       // B: Время операции
        dayNight,                      // C: День/Ночь
        parameter.employeeId,          // D: ID Сотрудника
        parameter.employeeShift || "",  // E: Смена
        parameter.employeeName,        // F: ФИО сотрудника
        parameter.zone,                // G: Зона склада
        parameter.inputType,           // H: Тип ввода
        parameter.barcode,             // I: Штрих-код
        parameter.boxCode || "",       // J: Короб
        parameter.orderId || "",       // K: Номер заказа
        parameter.gmNumber || "",      // L: Номер ГМ
        parameter.problem,             // M: Проблема
        Number(parameter.qty || 1),    // N: Количество
        "",                            // O: Описание (для python)
        "",                            // P: Цена (для python)
        "",                            // Q: Сумма (для python)
        parameter.actionTaken          // R: Принятое решение
      ]);

      response = { success: true, message: "Запись успешно добавлена" };

    } else if (action === "getHistory") {
      var logSheet = ss.getSheetByName("Log");
      var logData = logSheet.getDataRange().getValues();
      var employeeId = parameter.employeeId;
      var userLogs = [];

      // Считываем последние 50 записей с конца (исключая заголовок)
      for (var i = logData.length - 1; i >= 1; i--) {
        if (String(logData[i][3]) === String(employeeId)) {
          userLogs.push({
            timestamp: logData[i][0] + " " + logData[i][1],
            barcode: logData[i][8],
            inputType: logData[i][7],
            problem: logData[i][12],
            qty: logData[i][13],
            action: logData[i][17],
            boxCode: logData[i][9] || "",
            orderId: logData[i][10] || "",
            gmNumber: logData[i][11] || ""
          });
        }
        if (userLogs.length >= 20) break; // Возвращаем последние 20 записей сотрудника
      }

      response = {
        success: true,
        logs: userLogs
      };
    }

  } catch (error) {
    response = { success: false, message: "Ошибка сервера: " + error.toString() };
  }

  // Возвращаем результат в формате JSON с заголовками CORS
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

// Функция автоматической настройки структуры таблицы
function autoSetupIfNeeded(ss) {
  if (!ss.getSheetByName("Employees") || !ss.getSheetByName("Log") || !ss.getSheetByName("Config")) {
    setupSheet();
  }
}

// Инициализация структуры таблицы (можно запустить один раз вручную)
function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Создаем лист сотрудников, если его нет
  var empSheet = ss.getSheetByName("Employees");
  if (!empSheet) {
    empSheet = ss.insertSheet("Employees");
    empSheet.appendRow(["ID", "ФИО", "Смена"]);
    empSheet.appendRow(["111", "Алексей Смирнов", "1 смена"]);
    empSheet.appendRow(["222", "Дмитрий Иванов", "2 смена"]);
    empSheet.appendRow(["333", "Мария Козлова", "3 смена"]);

    // Форматируем шапку
    empSheet.getRange("A1:C1").setBackground("#7f3eff").setFontColor("#ffffff").setFontWeight("bold");
    empSheet.autoResizeColumns(1, 3);
  }

  // 2. Создаем лист логов, если его нет
  var logSheet = ss.getSheetByName("Log");
  if (!logSheet) {
    logSheet = ss.insertSheet("Log");
    logSheet.appendRow([
      "Дата операции",
      "Время операции",
      "День/Ночь",
      "ID Сотрудника",
      "Смена",
      "ФИО сотрудника",
      "Зона склада",
      "Тип ввода",
      "Штрих-код",
      "Короб",
      "Номер заказа",
      "Номер ГМ",
      "Проблема",
      "Количество",
      "Описание",
      "Цена",
      "Сумма",
      "Принятое решение"
    ]);

    // Форматируем шапку
    logSheet.getRange("A1:R1").setBackground("#7f3eff").setFontColor("#ffffff").setFontWeight("bold");
    logSheet.autoResizeColumns(1, 18);
  }

  // 3. Создаем лист конфигурации, если его нет
  var configSheet = ss.getSheetByName("Config");
  if (!configSheet) {
    configSheet = ss.insertSheet("Config");
    configSheet.appendRow([
      "Проблемы",
      "Решения (Кнопки)",
      "Параметры Telegram",
      "Значения параметров"
    ]);

    configSheet.appendRow(["Брак", "Вернули на сток", "TELEGRAM_BOT_TOKEN", "ВСТАВЬТЕ_ТОКЕН_БОТА_СЮДА"]);
    configSheet.appendRow(["Неверный товар", "Брак, замена", "TELEGRAM_CHAT_ID", "ВСТАВЬТЕ_ID_ЧАТА_СЮДА"]);
    configSheet.appendRow(["Недокомплект", "Брак, вычерк", "TELEGRAM_THREAD_ID", "Оставьте пустым или вставьте ID темы (топика)"]);
    configSheet.appendRow(["Лишний товар", "Потеря замена", "", ""]);
    configSheet.appendRow(["Потеря", "Потеря вычерк", "", ""]);
    configSheet.appendRow(["ASL BELGISI", "Потеря компенсация на сотрудника", "", ""]);
    configSheet.appendRow(["ФРОД", "Решено | ASL BELGISI", "", ""]);

    // Форматируем шапку
    configSheet.getRange("A1:D1").setBackground("#7f3eff").setFontColor("#ffffff").setFontWeight("bold");
    configSheet.autoResizeColumns(1, 4);
  }

  // Удаляем пустой лист по умолчанию, если он остался пустым и мешает
  var defaultSheet = ss.getSheetByName("Лист1") || ss.getSheetByName("Sheet1");
  if (defaultSheet && defaultSheet.getLastRow() === 0) {
    ss.deleteSheet(defaultSheet);
  }
}

// --- ОТПРАВКА ЕЖЕДНЕВНОГО ОТЧЕТА В TELEGRAM ---
// Вы можете настроить автоматический запуск этой функции каждый день (триггер по времени).
// Перейдите в Apps Script: Триггеры (будильник слева) -> Добавить триггер.
// Выберите: sendDailyTelegramReport, по времени, ежедневный, выберите удобный час (например с 20:00 до 21:00).
function sendDailyTelegramReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName("Log");
  var configSheet = ss.getSheetByName("Config");

  if (!logSheet || !configSheet) return;

  // 1. Получаем настройки Telegram из Config
  var configData = configSheet.getDataRange().getValues();
  var botToken = "";
  var chatId = "";
  var threadId = "";

  for (var i = 1; i < configData.length; i++) {
    if (configData[i][2] === "TELEGRAM_BOT_TOKEN") botToken = String(configData[i][3]).trim();
    if (configData[i][2] === "TELEGRAM_CHAT_ID") chatId = String(configData[i][3]).trim();
    if (configData[i][2] === "TELEGRAM_THREAD_ID") threadId = String(configData[i][3]).trim();
  }

  if (!botToken || !chatId || botToken.indexOf("ВСТАВЬТЕ") !== -1 || chatId.indexOf("ВСТАВЬТЕ") !== -1) {
    Logger.log("Ошибка: Telegram Bot Token или Chat ID не заполнены в листе Config.");
    return;
  }

  // 2. Определяем смену по текущему времени
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var currentHour = Number(Utilities.formatDate(now, tz, "H"));

  var currentShift = "";
  var previousShift = "";
  var currentShiftLabel = "";
  var previousShiftLabel = "";
  var currentStats, prevStats;

  var logData = logSheet.getDataRange().getValues();

  if (currentHour >= 12) {
    // Вечерний отчет (в 21:00) -> о Дневной смене сегодня
    currentShift = "День";
    previousShift = "Ночь";
    currentShiftLabel = "Дневная смена (09:00 - 21:00)";
    previousShiftLabel = "Ночная смена (21:00 вчера - 09:00 сегодня)";

    currentStats = getShiftStats(logData, "День", now, tz);
    currentStats.dateTitle = formatDateRu(now) + " (день)";

    prevStats = getShiftStats(logData, "Ночь", now, tz);
  } else {
    // Утренний отчет (в 09:00) -> о Ночной смене, закончившейся сегодня
    currentShift = "Ночь";
    previousShift = "День";
    currentShiftLabel = "Ночная смена (21:00 вчера - 09:00 сегодня)";
    previousShiftLabel = "Дневная смена вчера (09:00 - 21:00)";

    currentStats = getShiftStats(logData, "Ночь", now, tz);

    var yesterday = new Date(now.getTime());
    yesterday.setDate(now.getDate() - 1);
    currentStats.dateTitle = formatDateRu(yesterday) + " (ночь)";

    prevStats = getShiftStats(logData, "День", yesterday, tz);
  }

  // 3. Вычисляем разницу и динамику
  var diffQty = currentStats.totalQty - prevStats.totalQty;
  var dynamicsText = "";
  if (prevStats.totalQty > 0) {
    var pct = (diffQty / prevStats.totalQty) * 100;
    var pctSign = pct >= 0 ? "+" : "";
    var arrow = diffQty >= 0 ? "📈" : "📉";
    var verb = diffQty >= 0 ? "Прирост" : "Снижение";
    dynamicsText = arrow + " *" + verb + ": " + (diffQty >= 0 ? "+" : "") + diffQty + " шт.* (" + pctSign + pct.toFixed(1) + "%) относительно предыдущей смены (" + (previousShift === "День" ? "Дневной" : "Ночной") + ", было: " + prevStats.totalQty + " шт.)";
  } else {
    if (currentStats.totalQty > 0) {
      dynamicsText = "📈 *Прирост: +" + currentStats.totalQty + " шт.* относительно предыдущей смены (в ней не было записей)";
    } else {
      dynamicsText = "➡️ *Без изменений* относительно предыдущей смены (записей нет)";
    }
  }

  // Если за смену нет записей, шлем пустой отчет
  if (currentStats.totalItems === 0) {
    var emptyMsg = "📊 *Отчет | Проблемка - РПЗ*\n";
    emptyMsg += "📅 *Дата:* " + currentStats.dateTitle + "\n\n";
    emptyMsg += "В этой смене записей не зафиксировано. Все чисто! ✅\n\n";
    emptyMsg += dynamicsText;
    sendToTelegram(botToken, chatId, emptyMsg, threadId);
    return;
  }

  // 4. Формируем красивое текстовое сообщение
  var msg = "📊 *Отчет | Проблемка - РПЗ*\n";
  msg += "📅 *Дата:* " + currentStats.dateTitle + "\n\n";
  msg += "📦 Обработано проблемных товаров: *" + currentStats.totalQty + " шт.*\n";
  msg += dynamicsText + "\n\n";

  msg += "📍 *По зонам склада (количество):*\n";
  msg += "• Позаказная: *" + (currentStats.zoneStats["Позаказная"] || 0) + " шт.*\n";
  msg += "• Потоварка: *" + (currentStats.zoneStats["Потоварка"] || 0) + " шт.*\n";
  msg += "• Отгрузка: *" + (currentStats.zoneStats["Отгрузка"] || 0) + " шт.*\n\n";

  msg += "⚙️ *Результаты обработки (решения):*\n";
  var hasActions = false;
  for (var act in currentStats.actionStats) {
    msg += "• " + act + ": *" + currentStats.actionStats[act] + " шт.*\n";
    hasActions = true;
  }
  if (!hasActions) msg += "• Нет решений\n";

  // 5. Отправляем в Telegram
  sendToTelegram(botToken, chatId, msg, threadId);
}

// Вспомогательная функция подсчета статистики за определенную смену
function getShiftStats(logData, shiftType, dateObj, tz) {
  var targetDateStr = Utilities.formatDate(dateObj, tz, "dd.MM.yyyy");

  var prevDateObj = new Date(dateObj.getTime());
  prevDateObj.setDate(dateObj.getDate() - 1);
  var prevDateStr = Utilities.formatDate(prevDateObj, tz, "dd.MM.yyyy");

  var totalItems = 0;
  var totalQty = 0;
  var zoneStats = { "Позаказная": 0, "Потоварка": 0, "Отгрузка": 0 };
  var actionStats = {};
  var userStats = {};

  for (var i = 1; i < logData.length; i++) {
    var cellValue = logData[i][0]; // A: Дата операции
    var rowDateStr = "";
    if (cellValue instanceof Date) {
      rowDateStr = Utilities.formatDate(cellValue, tz, "dd.MM.yyyy");
    } else {
      rowDateStr = String(cellValue).trim();
    }

    var rowShift = logData[i][2]; // C: Смена (День/Ночь)
    var rowTimeStr = logData[i][1]; // B: Время операции (HH:mm:ss)
    var rowHour = 0;
    if (rowTimeStr) {
      if (rowTimeStr instanceof Date) {
        rowHour = Number(Utilities.formatDate(rowTimeStr, tz, "H"));
      } else {
        var str = String(rowTimeStr).trim();
        var match = str.match(/(\d{1,2}):\d{2}:\d{2}/);
        if (match) {
          rowHour = Number(match[1]);
        } else {
          var parts = str.split(':');
          if (parts.length > 0) {
            rowHour = Number(parts[0]) || 0;
          }
        }
      }
    }

    var isMatch = false;
    if (shiftType === "День") {
      // Для Дневной смены: дата совпадает с целевой датой, смена "День"
      if (rowDateStr === targetDateStr && rowShift === "День") {
        isMatch = true;
      }
    } else if (shiftType === "Ночь") {
      // Для Ночной смены, заканчивающейся в целевую дату:
      // 1) В целевую дату до 09:00 смены "Ночь"
      // 2) В предыдущую дату с 21:00 смены "Ночь"
      if ((rowDateStr === targetDateStr && rowShift === "Ночь" && rowHour < 9) ||
        (rowDateStr === prevDateStr && rowShift === "Ночь" && rowHour >= 21)) {
        isMatch = true;
      }
    }

    if (isMatch) {
      var zone = logData[i][6]; // G: Зона склада (индекс 6)
      var userName = logData[i][5]; // F: ФИО сотрудника (индекс 5)
      var qty = Number(logData[i][13]) || 1; // N: Количество (индекс 13)
      var action = logData[i][17]; // R: Принятое решение (индекс 17)

      totalItems++;
      totalQty += qty;

      if (zone) {
        zoneStats[zone] = (zoneStats[zone] || 0) + qty;
      }
      if (action) {
        actionStats[action] = (actionStats[action] || 0) + qty;
      }
      if (userName) {
        userStats[userName] = (userStats[userName] || 0) + qty;
      }
    }
  }

  return {
    totalItems: totalItems,
    totalQty: totalQty,
    zoneStats: zoneStats,
    actionStats: actionStats,
    userStats: userStats
  };
}

// Функция для ручного тестирования отправки простого сообщения ботом
function sendTestTelegramMessage() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var configSheet = ss.getSheetByName("Config");
  if (!configSheet) {
    Logger.log("Ошибка: Лист Config не найден.");
    return;
  }

  var configData = configSheet.getDataRange().getValues();
  var botToken = "";
  var chatId = "";
  var threadId = "";

  for (var i = 1; i < configData.length; i++) {
    if (configData[i][2] === "TELEGRAM_BOT_TOKEN") botToken = String(configData[i][3]).trim();
    if (configData[i][2] === "TELEGRAM_CHAT_ID") chatId = String(configData[i][3]).trim();
    if (configData[i][2] === "TELEGRAM_THREAD_ID") threadId = String(configData[i][3]).trim();
  }

  if (!botToken || !chatId || botToken.indexOf("ВСТАВЬТЕ") !== -1 || chatId.indexOf("ВСТАВЬТЕ") !== -1) {
    Logger.log("Ошибка: Пожалуйста, заполните токен бота и ID чата в таблице на листе Config.");
    return;
  }

  var testMsg = "🔔 *Тестовое сообщение*\n\nВаш Telegram-бот для отчетов успешно настроен и подключен к Google Таблице! 🎉";
  sendToTelegram(botToken, chatId, testMsg, threadId);
}

// Вспомогательная функция отправки запроса в Telegram Bot API с поддержкой тем (топиков)
function sendToTelegram(token, chatId, text, threadId) {
  var url = "https://api.telegram.org/bot" + token + "/sendMessage";
  var payload = {
    "chat_id": chatId,
    "text": text,
    "parse_mode": "Markdown"
  };

  if (threadId && threadId !== "" && threadId !== "Оставьте пустым или вставьте ID темы (топика)") {
    payload["message_thread_id"] = Number(threadId);
  }

  var options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  var response = UrlFetchApp.fetch(url, options);
  Logger.log("Telegram отправка: " + response.getContentText());
}

// Форматирование даты на русском
function formatDateRu(date) {
  var options = { day: 'numeric', month: 'long', year: 'numeric' };
  // Простой парсинг на случай, если locale не поддерживается
  var months = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"
  ];
  return date.getDate() + " " + months[date.getMonth()] + " " + date.getFullYear() + " г.";
}
