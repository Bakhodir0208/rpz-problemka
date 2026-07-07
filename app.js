/**
 * Клиентская логика приложения для проблемного отдела склада
 */

// --- КОНФИГУРАЦИЯ ---
const savedUrl = localStorage.getItem('google_script_api_url');
const defaultUrl = 'https://script.google.com/macros/s/AKfycbw1RdqM2v1-wiw9BswkZ49lqoZFWy7wPCp_fI6q_NnwTm8cVtTgnHE3Ju5ck8db_9I/exec';

const CONFIG = {
    apiHostUrl: savedUrl !== null ? savedUrl : defaultUrl,
    isDemoMode: savedUrl !== null ? !savedUrl : false
};

// --- СОСТОЯНИЕ ПРИЛОЖЕНИЯ ---
let currentUser = null;
let currentZone = null;
let currentPozakaznayaSubtype = 'Сборка';
let currentInputType = 'item'; // 'item' или 'box'
let selectedProblem = null;
let soundEnabled = true;

// Сопоставление проблем с иконками и классами стилей
const PROBLEM_METADATA = {
    'Брак': { icon: '💥', class: 'prob-defect' },
    'Неверный товар': { icon: '🔄', class: 'prob-wrong' },
    'Недокомплект': { icon: '🧩', class: 'prob-incomplete' },
    'Лишний товар': { icon: '➕', class: 'prob-surplus' },
    'Потеря': { icon: '🔍', class: 'prob-lost' },
    'ASL BELGISI': { icon: '🏷️', class: 'prob-asl' },
    'ФРОД': { icon: '🕵️', class: 'prob-fraud' },
    'Без бирки': { icon: '🏷️', class: 'prob-no-tag' }
};

let pendingSubmitAction = null;
let addedItems = [];

// Списки проблем и решений по умолчанию (если не загрузились из Google Sheets)
let problemsList = ['Брак', 'Неверный товар', 'Недокомплект', 'Лишний товар', 'Потеря', 'ASL BELGISI', 'ФРОД'];
let actionsList = [
    { id: 'return_stock', name: 'Вернули на сток', icon: '🔄', class: 'act-return-stock' },
    { id: 'defect_replace', name: 'Брак, замена', icon: '📦', class: 'act-defect-replace' },
    { id: 'defect_cancel', name: 'Брак, вычерк', icon: '❌', class: 'act-defect-cancel' },
    { id: 'lost_replace', name: 'Потеря замена', icon: '🔁', class: 'act-lost-replace' },
    { id: 'lost_cancel', name: 'Потеря вычерк', icon: '🗑️', class: 'act-lost-cancel' },
    { id: 'lost_compensate', name: 'Потеря компенсация на сотрудника', icon: '👤', class: 'act-lost-compensate' },
    { id: 'resolved_asl', name: 'Решено | ASL BELGISI', icon: '🏷️', class: 'act-resolved-asl' }
];

// --- Web Audio API (Звуки без аудиофайлов в стиле Apple) ---
let audioCtx = null;

function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

function playSound(type) {
    if (!soundEnabled) return;
    try {
        const ctx = getAudioContext();
        const t = ctx.currentTime;

        if (type === 'success') {
            // Эмуляция фирменного двойного колокольчика Apple Pay (C6 -> E6)

            // Первый писк (C6)
            const osc1 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(1046.5, t);
            gain1.gain.setValueAtTime(0.08, t);
            gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
            osc1.connect(gain1);
            gain1.connect(ctx.destination);
            osc1.start(t);
            osc1.stop(t + 0.12);

            // Второй писк с задержкой 60мс (E6)
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1318.5, t + 0.06);
            gain2.gain.setValueAtTime(0.08, t + 0.06);
            gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            osc2.start(t + 0.06);
            osc2.stop(t + 0.22);

        } else if (type === 'error') {
            // Эмуляция приятного, но отчетливого двойного сигнала ошибки (beep-beep) в стиле iOS

            // Первый сигнал (D5)
            const osc1 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(587.33, t);
            gain1.gain.setValueAtTime(0.08, t);
            gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
            osc1.connect(gain1);
            gain1.connect(ctx.destination);
            osc1.start(t);
            osc1.stop(t + 0.08);

            // Второй сигнал через 100мс (D5)
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(587.33, t + 0.1);
            gain2.gain.setValueAtTime(0.08, t + 0.1);
            gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            osc2.start(t + 0.1);
            osc2.stop(t + 0.18);
        }
    } catch (e) {
        console.error('Ошибка воспроизведения звука:', e);
    }
}

// --- ИНИЦИАЛИЗАЦИЯ ПРИ СТАРТЕ ---
document.addEventListener('DOMContentLoaded', () => {
    initSound();
    initSettingsTrigger();
    checkSavedSession();
    setupEventListeners();
    updateDemoBanner();
});

// Настройка звукового переключателя
function initSound() {
    const soundToggle = document.getElementById('soundToggle');
    const savedSound = localStorage.getItem('sound_enabled');
    if (savedSound === 'false') {
        soundEnabled = false;
        soundToggle.classList.add('muted');
    }

    soundToggle.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        localStorage.setItem('sound_enabled', soundEnabled);
        soundToggle.classList.toggle('muted', !soundEnabled);

        // Тестовый писк для активации аудиоконтекста в браузере
        if (soundEnabled) {
            playSound('success');
        }
    });
}

// Скрытая кнопка настроек Google Apps Script URL (при клике на лого-иконку ⚠️)
function initSettingsTrigger() {
    const logoBox = document.querySelector('.logo-box');
    if (logoBox) {
        logoBox.addEventListener('click', () => {
            configureApiUrl();
        });
    }
}

function configureApiUrl() {
    const currentUrl = localStorage.getItem('google_script_api_url') || '';
    const newUrl = prompt('Введите URL веб-приложения Google Apps Script (оставьте пустым для демо-режима):', currentUrl);

    if (newUrl !== null) {
        const cleanUrl = newUrl.trim();
        if (cleanUrl) {
            localStorage.setItem('google_script_api_url', cleanUrl);
            CONFIG.apiHostUrl = cleanUrl;
            CONFIG.isDemoMode = false;
            alert('URL сохранен! Приложение перезагрузится.');
        } else {
            localStorage.removeItem('google_script_api_url');
            CONFIG.apiHostUrl = '';
            CONFIG.isDemoMode = true;
            alert('Режим переключен на ДЕМО. Приложение перезагрузится.');
        }
        window.location.reload();
    }
}

// Отображение индикатора демо-режима
function updateDemoBanner() {
    let banner = document.getElementById('demoBanner');
    if (CONFIG.isDemoMode) {
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'demoBanner';
            banner.style.cssText = `
                background: var(--warning-color);
                color: #000;
                text-align: center;
                font-size: 13px;
                font-weight: 700;
                padding: 6px;
                cursor: pointer;
                border-radius: var(--border-radius-sm);
                margin-bottom: 12px;
                box-shadow: var(--shadow-sm);
            `;
            banner.innerHTML = '⚠️ РЕЖИМ ДЕМО (Кликните для настройки Google Script)';
            banner.addEventListener('click', configureApiUrl);
            document.querySelector('.app-container').prepend(banner);
        }
    } else {
        if (banner) banner.remove();
    }
}

// Проверка сессии
function checkSavedSession() {
    const savedUser = localStorage.getItem('warehouse_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showScreen('zoneScreen');
        updateUserUI();
        loadDynamicConfig();
    }
}

// Переключение экранов
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    const activeScreen = document.getElementById(screenId);
    activeScreen.classList.add('active');

    // Автофокус на поле штрих-кода
    if (screenId === 'loggingScreen') {
        setTimeout(focusBarcode, 300);
    }
}

function focusBarcode() {
    if (currentZone === 'Потоварка') {
        const input = document.getElementById('potovarkaItemInput');
        if (input) input.focus();
    } else if (currentZone === 'Отгрузка') {
        const input = document.getElementById('otgruzkaItemInput');
        if (input) input.focus();
    } else {
        const input = document.getElementById('barcodeInput');
        if (input) input.focus();
    }
}

function updateUserUI() {
    if (currentUser) {
        document.getElementById('userInfo').textContent = `Сотрудник: ${currentUser.name}`;
        document.getElementById('loggingUserInfo').textContent = `Оператор: ${currentUser.name}`;
    }
}

// --- СЛУШАТЕЛИ СОБЫТИЙ ---
function setupEventListeners() {
    // Обработка кнопок модального окна подтверждения
    document.getElementById('confirmCancelBtn').addEventListener('click', () => {
        closeConfirmModal();
    });

    document.getElementById('confirmSubmitBtn').addEventListener('click', () => {
        if (pendingSubmitAction) {
            submitRecord(pendingSubmitAction, true);
        }
    });

    // 1. Форма входа
    document.getElementById('authForm').addEventListener('submit', handleLogin);

    // Выход из системы
    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('warehouse_user');
        currentUser = null;
        showScreen('authScreen');
    });

    // 2. Кнопки зон
    document.querySelectorAll('.zone-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const button = e.currentTarget;
            currentZone = button.getAttribute('data-zone');
            document.getElementById('activeZoneBadge').textContent = `Зона: ${currentZone}`;

            const recordForm = document.getElementById('recordForm');
            if (currentZone === 'Позаказная') {
                recordForm.setAttribute('data-flow-mode', 'by-order-acceptance');
                resetByOrderForm();
            } else if (currentZone === 'Потоварка') {
                recordForm.setAttribute('data-flow-mode', 'potovarka');
                resetPotovarkaForm();
            } else if (currentZone === 'Отгрузка') {
                recordForm.setAttribute('data-flow-mode', 'otgruzka');
                resetOtgruzkaForm();
            } else {
                recordForm.setAttribute('data-flow-mode', 'standard');
                resetLoggingForm();
            }

            showScreen('loggingScreen');
            loadHistory();
            renderConfigOptions();
        });
    });

    // Возврат из фиксации к зонам
    document.getElementById('backToZonesBtn').addEventListener('click', () => {
        showScreen('zoneScreen');
    });

    // 3. Выбор типа ввода (Товар / Короб)
    const typeTabs = document.querySelectorAll('.type-tab');
    const barcodeLabel = document.getElementById('barcodeLabel');
    const barcodeInput = document.getElementById('barcodeInput');

    typeTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            typeTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentInputType = tab.getAttribute('data-type');

            // Настройка полей под выбранный режим
            if (currentInputType === 'item') {
                barcodeLabel.textContent = 'Штрих-код товара';
                barcodeInput.placeholder = 'Отсканируйте ШК товара...';
                barcodeInput.setAttribute('inputmode', 'numeric');
                barcodeInput.setAttribute('pattern', '[0-9]*');
                if (barcodeInput.value.startsWith('80-')) {
                    barcodeInput.value = '';
                }
            } else {
                barcodeLabel.textContent = 'Штрих-код короба';
                barcodeInput.placeholder = 'Введите номер короба...';
                barcodeInput.setAttribute('inputmode', 'text');
                barcodeInput.removeAttribute('pattern');
            }

            clearBarcodeError();
            focusBarcode();
        });
    });

    // Обработка ручного изменения ШК (автофокус и сброс ошибок при печати)
    barcodeInput.addEventListener('input', () => {
        clearBarcodeError();
    });

    // Обработка кнопки Enter (сканирование с ТСД)
    barcodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const valid = validateBarcode();
            if (valid) {
                playSound('success');
                // Визуальный эффект успешного сканирования (мигание зеленой рамкой)
                barcodeInput.style.borderColor = 'var(--success-color)';
                setTimeout(() => {
                    barcodeInput.style.borderColor = '';
                }, 400);
            } else {
                playSound('error');
            }
        }
    });

    // Управление количеством
    const qtyInput = document.getElementById('qtyInput');
    document.getElementById('qtyMinus').addEventListener('click', () => {
        const val = parseInt(qtyInput.value) || 1;
        if (val > 1) qtyInput.value = val - 1;
    });
    document.getElementById('qtyPlus').addEventListener('click', () => {
        const val = parseInt(qtyInput.value) || 1;
        qtyInput.value = val + 1;
    });

    // --- ОБРАБОТЧИКИ ДЛЯ ЗОНЫ ПОЗАКАЗНАЯ ---
    const byOrderBoxInput = document.getElementById('byOrderBoxInput');
    const byOrderItemInput = document.getElementById('byOrderItemInput');
    const byOrderOrderInput = document.getElementById('byOrderOrderInput');
    const byOrderQtyInput = document.getElementById('byOrderQtyInput');
    const byOrderNextBtn = document.getElementById('byOrderNextBtn');
    const byOrderBackBtn = document.getElementById('byOrderBackBtn');

    // Под-режимы Позаказной (Сборка / Сорт. 1 / Сорт. 2 / Упаковка)
    const subtypeBtns = document.querySelectorAll('.subtype-btn');
    const byOrderBoxLabel = document.getElementById('byOrderBoxLabel');
    subtypeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            subtypeBtns.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentPozakaznayaSubtype = e.currentTarget.getAttribute('data-subtype');

            // Сброс ошибок при переключении
            document.getElementById('byOrderBoxGroup').classList.remove('invalid');
            document.getElementById('byOrderBoxError').textContent = '';

            const summaryBoxLabel = document.getElementById('summaryBoxLabel');
            const summaryItemsLabel = document.getElementById('summaryItemsLabel');
            const confirmBoxLabel = document.getElementById('confirmBoxLabel');

            if (currentPozakaznayaSubtype === 'Упаковка') {
                if (byOrderBoxLabel) byOrderBoxLabel.textContent = 'Номер ячейки';
                byOrderBoxInput.placeholder = 'Введите или отсканируйте номер ячейки';
                if (summaryBoxLabel) summaryBoxLabel.textContent = '📦 Ячейка:';
                if (summaryItemsLabel) summaryItemsLabel.textContent = '🛒 Список товаров в ячейке:';
                if (confirmBoxLabel) confirmBoxLabel.textContent = '📦 Ячейка:';
            } else {
                if (byOrderBoxLabel) byOrderBoxLabel.textContent = 'Короб';
                byOrderBoxInput.placeholder = 'Отсканируйте короб';
                if (summaryBoxLabel) summaryBoxLabel.textContent = '📦 Короб:';
                if (summaryItemsLabel) summaryItemsLabel.textContent = '🛒 Список товаров в коробе:';
                if (confirmBoxLabel) confirmBoxLabel.textContent = '📦 Короб:';
            }

            checkByOrderInputsValidity();
        });
    });

    // Очистка индивидуальных ошибок при наборе текста
    byOrderBoxInput.addEventListener('input', () => {
        document.getElementById('byOrderBoxGroup').classList.remove('invalid');
        document.getElementById('byOrderBoxError').textContent = '';
        checkByOrderInputsValidity();
    });

    byOrderItemInput.addEventListener('input', () => {
        document.getElementById('byOrderItemGroup').classList.remove('invalid');
        document.getElementById('byOrderItemError').textContent = '';
        checkByOrderInputsValidity();
    });

    byOrderOrderInput.addEventListener('input', () => {
        // Автоматическая смена раскладки клавиатуры с русской на английскую
        const converted = convertCyrillicToLatinLayout(byOrderOrderInput.value);
        if (converted !== byOrderOrderInput.value) {
            byOrderOrderInput.value = converted;
        }
        document.getElementById('byOrderOrderGroup').classList.remove('invalid');
        document.getElementById('byOrderOrderError').textContent = '';
        checkByOrderInputsValidity();
    });

    // Обработка потери фокуса (blur) для отображения ошибок
    byOrderBoxInput.addEventListener('blur', () => {
        const val = byOrderBoxInput.value.trim();
        if (val !== '') {
            let isValid = false;
            let errorMsg = '';
            if (currentPozakaznayaSubtype === 'Упаковка') {
                isValid = /^\d+\.\d+\.\d+\.\d+$/.test(val);
                errorMsg = 'Номер ячейки введен не правильно';
            } else {
                isValid = val.startsWith('80-') && val.length === 13;
                errorMsg = 'ШК короба введен не правильно';
            }
            if (!isValid) {
                playSound('error');
                document.getElementById('byOrderBoxGroup').classList.add('invalid');
                document.getElementById('byOrderBoxError').textContent = errorMsg;
            }
        }
    });

    byOrderItemInput.addEventListener('blur', () => {
        const val = byOrderItemInput.value.trim();
        if (val !== '') {
            const isValid = /^\d{13}$/.test(val);
            if (!isValid) {
                playSound('error');
                document.getElementById('byOrderItemGroup').classList.add('invalid');
                document.getElementById('byOrderItemError').textContent = 'ШК товара введен не правильно';
            }
        }
    });

    byOrderOrderInput.addEventListener('blur', () => {
        const val = byOrderOrderInput.value.trim();
        if (val !== '') {
            const isValid = validateOrderFormat(val);
            if (!isValid) {
                playSound('error');
                document.getElementById('byOrderOrderGroup').classList.add('invalid');
                document.getElementById('byOrderOrderError').textContent = 'Номер заказа введен не правильно';
            }
        }
    });

    // Обработка Enter (ТСД)
    byOrderBoxInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = e.target.value.trim();
            let isValid = false;
            let errorMsg = '';
            if (currentPozakaznayaSubtype === 'Упаковка') {
                isValid = /^\d+\.\d+\.\d+\.\d+$/.test(val);
                errorMsg = 'Номер ячейки введен не правильно';
            } else {
                isValid = val.startsWith('80-') && val.length === 13;
                errorMsg = 'ШК короба введен не правильно';
            }
            if (isValid) {
                playSound('success');
                e.target.style.borderColor = 'var(--success-color)';
                setTimeout(() => e.target.style.borderColor = '', 400);
                byOrderItemInput.focus();
            } else {
                playSound('error');
                document.getElementById('byOrderBoxGroup').classList.add('invalid');
                document.getElementById('byOrderBoxError').textContent = errorMsg;
            }
            checkByOrderInputsValidity();
        }
    });

    byOrderItemInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = e.target.value.trim();
            const isValid = /^\d{13}$/.test(val);
            if (isValid) {
                playSound('success');
                e.target.style.borderColor = 'var(--success-color)';
                setTimeout(() => e.target.style.borderColor = '', 400);
                byOrderOrderInput.focus();
            } else {
                playSound('error');
                document.getElementById('byOrderItemGroup').classList.add('invalid');
                document.getElementById('byOrderItemError').textContent = 'ШК товара введен не правильно';
            }
            checkByOrderInputsValidity();
        }
    });

    byOrderOrderInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = e.target.value.trim();
            const isValid = validateOrderFormat(val);
            if (isValid) {
                e.target.style.borderColor = 'var(--success-color)';
                setTimeout(() => e.target.style.borderColor = '', 400);
                addCurrentItemToList();
            } else {
                playSound('error');
                document.getElementById('byOrderOrderGroup').classList.add('invalid');
                document.getElementById('byOrderOrderError').textContent = 'Номер заказа введен не правильно';
            }
        }
    });

    // Кнопка Добавить товар
    document.getElementById('byOrderAddItemBtn').addEventListener('click', () => {
        addCurrentItemToList();
    });

    // Управление количеством в позаказной зоне
    document.getElementById('byOrderQtyMinus').addEventListener('click', () => {
        const val = parseInt(byOrderQtyInput.value) || 1;
        if (val > 1) byOrderQtyInput.value = val - 1;
    });
    document.getElementById('byOrderQtyPlus').addEventListener('click', () => {
        const val = parseInt(byOrderQtyInput.value) || 1;
        byOrderQtyInput.value = val + 1;
    });

    // Кнопка перехода к решению
    byOrderNextBtn.addEventListener('click', () => {
        goToByOrderDecision();
    });

    // Кнопка возврата к приёмке
    byOrderBackBtn.addEventListener('click', () => {
        document.getElementById('recordForm').setAttribute('data-flow-mode', 'by-order-acceptance');
        setTimeout(() => {
            const boxVal = byOrderBoxInput.value.trim();
            if (boxVal) {
                byOrderItemInput.focus();
            } else {
                byOrderBoxInput.focus();
            }
        }, 100);
    });
    // Обработка кнопок быстрой очистки (.clear-btn)
    document.querySelectorAll('.clear-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const input = e.currentTarget.previousElementSibling;
            if (input) {
                input.value = '';
                input.focus();
                // Генерируем событие input, чтобы сработали валидация и сброс ошибок
                input.dispatchEvent(new Event('input'));
            }
        });
    });

    // --- ОБРАБОТЧИКИ ДЛЯ ЗОНЫ ПОТОВАРКА ---
    const potovarkaItemInput = document.getElementById('potovarkaItemInput');
    const potovarkaBoxInput = document.getElementById('potovarkaBoxInput');
    const potovarkaQtyInput = document.getElementById('potovarkaQtyInput');
    const potovarkaNoBoxBtn = document.getElementById('potovarkaNoBoxBtn');

    potovarkaItemInput.addEventListener('input', () => {
        document.getElementById('potovarkaItemGroup').classList.remove('invalid');
        document.getElementById('potovarkaItemError').textContent = '';
    });

    potovarkaBoxInput.addEventListener('input', () => {
        document.getElementById('potovarkaBoxGroup').classList.remove('invalid');
        document.getElementById('potovarkaBoxError').textContent = '';
    });

    potovarkaItemInput.addEventListener('blur', () => {
        const val = potovarkaItemInput.value.trim();
        if (val !== '') {
            const isValid = /^\d{13}$/.test(val);
            if (!isValid) {
                playSound('error');
                document.getElementById('potovarkaItemGroup').classList.add('invalid');
                document.getElementById('potovarkaItemError').textContent = 'ШК товара введен не правильно';
            }
        }
    });

    potovarkaBoxInput.addEventListener('blur', () => {
        const val = potovarkaBoxInput.value.trim();
        if (val !== '') {
            const isValid = (val.startsWith('80-') && val.length === 13) || val === 'Короб не определен';
            if (!isValid) {
                playSound('error');
                document.getElementById('potovarkaBoxGroup').classList.add('invalid');
                document.getElementById('potovarkaBoxError').textContent = 'ШК короба введен не правильно';
            }
        }
    });

    potovarkaItemInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = e.target.value.trim();
            const isValid = /^\d{13}$/.test(val);
            if (isValid) {
                playSound('success');
                e.target.style.borderColor = 'var(--success-color)';
                setTimeout(() => e.target.style.borderColor = '', 400);
                potovarkaBoxInput.focus();
            } else {
                playSound('error');
                document.getElementById('potovarkaItemGroup').classList.add('invalid');
                document.getElementById('potovarkaItemError').textContent = 'ШК товара введен не правильно';
            }
        }
    });

    potovarkaBoxInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = e.target.value.trim();
            const isValid = (val.startsWith('80-') && val.length === 13) || val === 'Короб не определен';
            if (isValid) {
                playSound('success');
                e.target.style.borderColor = 'var(--success-color)';
                setTimeout(() => e.target.style.borderColor = '', 400);
            } else {
                playSound('error');
                document.getElementById('potovarkaBoxGroup').classList.add('invalid');
                document.getElementById('potovarkaBoxError').textContent = 'ШК короба введен не правильно';
            }
        }
    });

    potovarkaNoBoxBtn.addEventListener('click', () => {
        potovarkaBoxInput.value = 'Короб не определен';
        playSound('success');
        document.getElementById('potovarkaBoxGroup').classList.remove('invalid');
        document.getElementById('potovarkaBoxError').textContent = '';
        potovarkaBoxInput.dispatchEvent(new Event('input'));
    });

    document.getElementById('potovarkaQtyMinus').addEventListener('click', () => {
        const val = parseInt(potovarkaQtyInput.value) || 1;
        if (val > 1) potovarkaQtyInput.value = val - 1;
    });
    document.getElementById('potovarkaQtyPlus').addEventListener('click', () => {
        const val = parseInt(potovarkaQtyInput.value) || 1;
        potovarkaQtyInput.value = val + 1;
    });

    // --- ОБРАБОТЧИКИ ДЛЯ ЗОНЫ ОТГРУЗКА ---
    const otgruzkaItemInput = document.getElementById('otgruzkaItemInput');
    const otgruzkaQtyInput = document.getElementById('otgruzkaQtyInput');
    const otgruzkaOrderInput = document.getElementById('otgruzkaOrderInput');
    const otgruzkaGmInput = document.getElementById('otgruzkaGmInput');

    otgruzkaItemInput.addEventListener('input', () => {
        document.getElementById('otgruzkaItemGroup').classList.remove('invalid');
        document.getElementById('otgruzkaItemError').textContent = '';
    });

    otgruzkaOrderInput.addEventListener('input', () => {
        // Автоматическая смена раскладки клавиатуры с русской на английскую
        const converted = convertCyrillicToLatinLayout(otgruzkaOrderInput.value);
        if (converted !== otgruzkaOrderInput.value) {
            otgruzkaOrderInput.value = converted;
        }
        document.getElementById('otgruzkaOrderGroup').classList.remove('invalid');
        document.getElementById('otgruzkaOrderError').textContent = '';
        document.getElementById('otgruzkaGmGroup').classList.remove('invalid');
        document.getElementById('otgruzkaGmError').textContent = '';
    });

    otgruzkaGmInput.addEventListener('input', () => {
        document.getElementById('otgruzkaOrderGroup').classList.remove('invalid');
        document.getElementById('otgruzkaOrderError').textContent = '';
        document.getElementById('otgruzkaGmGroup').classList.remove('invalid');
        document.getElementById('otgruzkaGmError').textContent = '';
    });

    otgruzkaItemInput.addEventListener('blur', () => {
        const val = otgruzkaItemInput.value.trim();
        if (val !== '') {
            const isValid = /^\d{13}$/.test(val);
            if (!isValid) {
                playSound('error');
                document.getElementById('otgruzkaItemGroup').classList.add('invalid');
                document.getElementById('otgruzkaItemError').textContent = 'ШК товара введен не правильно';
            }
        }
    });

    otgruzkaOrderInput.addEventListener('blur', () => {
        const val = otgruzkaOrderInput.value.trim();
        if (val !== '') {
            const isValid = validateOrderFormat(val);
            if (!isValid) {
                playSound('error');
                document.getElementById('otgruzkaOrderGroup').classList.add('invalid');
                document.getElementById('otgruzkaOrderError').textContent = 'Формат заказа неверный (должен начинаться на 10- и не содержать русские буквы)';
            }
        }
    });

    otgruzkaItemInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = e.target.value.trim();
            const isValid = /^\d{13}$/.test(val);
            if (isValid) {
                playSound('success');
                e.target.style.borderColor = 'var(--success-color)';
                setTimeout(() => e.target.style.borderColor = '', 400);
            } else {
                playSound('error');
                document.getElementById('otgruzkaItemGroup').classList.add('invalid');
                document.getElementById('otgruzkaItemError').textContent = 'ШК товара введен не правильно';
            }
        }
    });

    otgruzkaOrderInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitRecord('Решено');
        }
    });

    otgruzkaGmInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitRecord('Решено');
        }
    });

    document.getElementById('otgruzkaQtyMinus').addEventListener('click', () => {
        const val = parseInt(otgruzkaQtyInput.value) || 1;
        if (val > 1) otgruzkaQtyInput.value = val - 1;
    });
    document.getElementById('otgruzkaQtyPlus').addEventListener('click', () => {
        const val = parseInt(otgruzkaQtyInput.value) || 1;
        otgruzkaQtyInput.value = val + 1;
    });
}

// --- ВАЛИДАЦИЯ ШТРИХ-КОДА ---
function validateBarcode() {
    const input = document.getElementById('barcodeInput');
    const group = document.querySelector('.barcode-group');
    const errorEl = document.getElementById('barcodeError');
    const value = input.value.trim();

    clearBarcodeError();

    if (currentInputType === 'item') {
        // Условие: строго 13 цифр
        const isNumeric = /^\d+$/.test(value);
        if (value.length !== 13 || !isNumeric) {
            group.classList.add('invalid');
            errorEl.textContent = 'ШК товара введен не правильно';
            return false;
        }
    } else {
        // Условие: строго начинается на 80- и содержит 13 символов
        if (!value.startsWith('80-') || value.length !== 13) {
            group.classList.add('invalid');
            errorEl.textContent = 'ШК короба введен не правильно';
            return false;
        }
    }
    return true;
}

function clearBarcodeError() {
    const group = document.querySelector('.barcode-group');
    const errorEl = document.getElementById('barcodeError');
    if (group) group.classList.remove('invalid');
    if (errorEl) errorEl.textContent = '';
}

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ НОМЕРА ЗАКАЗА ---
function convertCyrillicToLatinLayout(text) {
    const map = {
        'Й': 'Q', 'Ц': 'W', 'У': 'E', 'К': 'R', 'Е': 'T', 'Н': 'Y', 'Г': 'U', 'Ш': 'I', 'Щ': 'O', 'З': 'P', 'Х': '[', 'Ъ': ']',
        'Ф': 'A', 'Ы': 'S', 'В': 'D', 'А': 'F', 'П': 'G', 'Р': 'H', 'О': 'J', 'Л': 'K', 'Д': 'L', 'Ж': ';', 'Э': "'",
        'Я': 'Z', 'Ч': 'X', 'С': 'C', 'М': 'V', 'И': 'B', 'Т': 'N', 'Ь': 'M', 'Б': ',', 'Ю': '.',
        'й': 'q', 'ц': 'w', 'у': 'e', 'к': 'r', 'е': 't', 'н': 'y', 'г': 'u', 'ш': 'i', 'щ': 'o', 'з': 'p', 'х': '[', 'ъ': ']',
        'ф': 'a', 'ы': 's', 'в': 'd', 'а': 'f', 'п': 'g', 'р': 'h', 'о': 'j', 'л': 'k', 'д': 'l', 'ж': ';', 'э': "'",
        'я': 'z', 'ч': 'x', 'с': 'c', 'м': 'v', 'и': 'b', 'т': 'n', 'ь': 'm', 'б': ',', 'ю': '.'
    };
    return text.split('').map(char => map[char] || char).join('');
}

function validateOrderFormat(val) {
    // 1. Должен начинаться на 10- и быть длиной не менее 4 символов
    if (!val.startsWith('10-') || val.length < 4) {
        return false;
    }
    // 2. Не должен содержать кириллицу (если буквы есть, они должны быть английскими)
    if (/[а-яА-ЯёЁ]/.test(val)) {
        return false;
    }
    return true;
}

// --- ВАЛИДАЦИЯ И ПЕРЕХОДЫ ДЛЯ ЗОНЫ ПОЗАКАЗНАЯ ---
function checkByOrderInputsValidity() {
    const boxInput = document.getElementById('byOrderBoxInput');
    const itemInput = document.getElementById('byOrderItemInput');
    const orderInput = document.getElementById('byOrderOrderInput');

    const boxVal = boxInput.value.trim();
    const itemVal = itemInput.value.trim();
    const orderVal = orderInput.value.trim();

    let isBoxValid = false;
    if (currentPozakaznayaSubtype === 'Упаковка') {
        isBoxValid = /^\d+\.\d+\.\d+\.\d+$/.test(boxVal);
    } else {
        isBoxValid = boxVal.startsWith('80-') && boxVal.length === 13;
    }
    const isItemValid = /^\d{13}$/.test(itemVal);
    const isOrderValid = validateOrderFormat(orderVal);

    const nextBtn = document.getElementById('byOrderNextBtn');
    if (nextBtn) {
        const hasAddedItems = addedItems.length > 0;
        const currentInputsValid = isItemValid && isOrderValid;
        nextBtn.disabled = !(isBoxValid && (hasAddedItems || currentInputsValid));
    }

    return { isBoxValid, isItemValid, isOrderValid };
}

function goToByOrderDecision() {
    const boxVal = document.getElementById('byOrderBoxInput').value.trim();
    const itemInput = document.getElementById('byOrderItemInput');
    const orderInput = document.getElementById('byOrderOrderInput');

    const itemVal = itemInput.value.trim();
    const orderVal = orderInput.value.trim();

    // Если в полях ввода лежат корректные данные, автоматически добавляем их в список
    const isItemValid = /^\d{13}$/.test(itemVal);
    const isOrderValid = validateOrderFormat(orderVal);
    if (isItemValid && isOrderValid) {
        addCurrentItemToList();
    }

    if (addedItems.length === 0) {
        playSound('error');
        updateStatus('Добавьте хотя бы один товар в короб!', 'error');
        return;
    }

    // Заполняем сводку
    document.getElementById('summaryBox').textContent = boxVal;

    // Заполняем список товаров в сводке решения
    const summaryList = document.getElementById('summaryItemsList');
    summaryList.innerHTML = '';
    addedItems.forEach(item => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.justify = 'space-between';
        div.innerHTML = `
            <span>🏷️ <b>${item.barcode}</b> (Заказ: ${item.orderId})</span>
            <span>x${item.qty} шт</span>
        `;
        summaryList.appendChild(div);
    });

    // Переключаем режим формы на окно решения
    document.getElementById('recordForm').setAttribute('data-flow-mode', 'by-order-decision');

    updateStatus('Выберите проблему и решение для отправки', '');
}

function resetByOrderForm(keepBoxCode = false) {
    const boxInput = document.getElementById('byOrderBoxInput');
    const itemInput = document.getElementById('byOrderItemInput');
    const orderInput = document.getElementById('byOrderOrderInput');
    const qtyInput = document.getElementById('byOrderQtyInput');

    if (boxInput && !keepBoxCode) boxInput.value = '';
    if (itemInput) itemInput.value = '';
    if (orderInput) orderInput.value = '';
    if (qtyInput) qtyInput.value = '1';

    // Сбрасываем выбранный подтип
    currentPozakaznayaSubtype = 'Сборка';
    const subtypeBtns = document.querySelectorAll('.subtype-btn');
    subtypeBtns.forEach(btn => {
        if (btn.getAttribute('data-subtype') === 'Сборка') {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    const byOrderBoxLabel = document.getElementById('byOrderBoxLabel');
    if (byOrderBoxLabel) byOrderBoxLabel.textContent = 'Короб';
    if (boxInput) boxInput.placeholder = 'Отсканируйте короб';

    const summaryBoxLabel = document.getElementById('summaryBoxLabel');
    const summaryItemsLabel = document.getElementById('summaryItemsLabel');
    const confirmBoxLabel = document.getElementById('confirmBoxLabel');

    if (summaryBoxLabel) summaryBoxLabel.textContent = '📦 Короб:';
    if (summaryItemsLabel) summaryItemsLabel.textContent = '🛒 Список товаров в коробе:';
    if (confirmBoxLabel) confirmBoxLabel.textContent = '📦 Короб:';

    // Очищаем добавленные во временный список товары
    addedItems = [];
    renderAddedItemsList();

    clearByOrderErrors();

    const nextBtn = document.getElementById('byOrderNextBtn');
    if (nextBtn) nextBtn.disabled = true;

    // Сбрасываем выбранную проблему
    selectedProblem = null;
    document.querySelectorAll('#byOrderProblemsContainer .option-btn').forEach(btn => {
        btn.classList.remove('selected');
    });

    updateStatus('Готов к работе', '');
}

function clearByOrderErrors() {
    ['byOrderBoxGroup', 'byOrderItemGroup', 'byOrderOrderGroup'].forEach(groupId => {
        const group = document.getElementById(groupId);
        if (group) group.classList.remove('invalid');
    });
    ['byOrderBoxError', 'byOrderItemError', 'byOrderOrderError'].forEach(errId => {
        const errEl = document.getElementById(errId);
        if (errEl) errEl.textContent = '';
    });
}

// --- АВТОРИЗАЦИЯ СОТРУДНИКА ---
function handleLogin(e) {
    e.preventDefault();
    const idInput = document.getElementById('employeeId');
    const errorEl = document.getElementById('authError');
    const id = idInput.value.trim();

    if (!id) {
        errorEl.textContent = 'Введите ваш ID';
        playSound('error');
        return;
    }

    errorEl.textContent = '';

    // Блокировка кнопки во время загрузки
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Вход...';

    if (CONFIG.isDemoMode) {
        // Имитация авторизации в демо-режиме
        setTimeout(() => {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Войти в систему';

            const mockUsers = {
                '111': { id: '111', name: 'Алексей Смирнов', role: 'Оператор', shift: '1 смена' },
                '222': { id: '222', name: 'Дмитрий Иванов', role: 'Оператор', shift: '2 смена' },
                '333': { id: '333', name: 'Мария Козлова', role: 'Оператор', shift: '3 смена' }
            };

            const user = mockUsers[id];
            if (user) {
                currentUser = user;
                localStorage.setItem('warehouse_user', JSON.stringify(user));
                playSound('success');
                showScreen('zoneScreen');
                updateUserUI();
                renderConfigOptions();
            } else {
                errorEl.textContent = 'Пользователь с таким ID не найден (демо: 111, 222, 333)';
                playSound('error');
            }
        }, 800);
    } else {
        // Запрос к реальному Google Apps Script API
        fetch(CONFIG.apiHostUrl, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                action: 'login',
                employeeId: id
            })
        })
            .then(response => response.json())
            .then(data => {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Войти в систему';

                if (data.success) {
                    currentUser = {
                        id: id,
                        name: data.name,
                        role: data.role,
                        shift: data.shift || ""
                    };
                    localStorage.setItem('warehouse_user', JSON.stringify(currentUser));
                    playSound('success');
                    showScreen('zoneScreen');
                    updateUserUI();
                    loadDynamicConfig();
                } else {
                    errorEl.textContent = data.message || 'Ошибка авторизации';
                    playSound('error');
                }
            })
            .catch(err => {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Войти в систему';
                errorEl.textContent = ' Ошибка сети/подключения к Google Sheets';
                console.error('Ошибка входа:', err);
                playSound('error');
            });
    }
}

// --- ЗАГРУЗКА ДИНАМИЧЕСКИХ НАСТРОЕК (ПРОБЛЕМЫ И РЕШЕНИЯ) ---
function loadDynamicConfig() {
    if (CONFIG.isDemoMode) {
        renderConfigOptions();
        return;
    }

    fetch(CONFIG.apiHostUrl + '?action=getConfig')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                if (data.problems && data.problems.length > 0) {
                    problemsList = data.problems;
                }
                if (data.actions && data.actions.length > 0) {
                    actionsList = data.actions.map((act, i) => {
                        const icons = ['📥', '❌', '📦', '🔄', '🏷️', '🛠️'];
                        return {
                            id: `action_${i}`,
                            name: act,
                            icon: icons[i % icons.length]
                        };
                    });
                }
            }
            renderConfigOptions();
        })
        .catch(err => {
            console.warn('Не удалось загрузить конфиг с сервера, используем дефолтные значения', err);
            renderConfigOptions();
        });
}

function renderConfigOptions() {
    // 1. Рендерим типы проблем во все имеющиеся контейнеры
    const problemContainers = [
        document.getElementById('problemsContainer'),
        document.getElementById('byOrderProblemsContainer'),
        document.getElementById('potovarkaProblemsContainer'),
        document.getElementById('otgruzkaProblemsContainer')
    ];

    problemContainers.forEach(pContainer => {
        if (!pContainer) return;
        pContainer.innerHTML = '';
    });

    selectedProblem = null;

    // Опеределяем список проблем для текущей зоны
    let currentProblems = problemsList;
    if (currentZone === 'Отгрузка') {
        currentProblems = ['Без бирки', 'Брак'];
    }

    currentProblems.forEach(prob => {
        problemContainers.forEach(pContainer => {
            if (!pContainer) return;

            // Фильтруем контейнеры
            if (currentZone === 'Отгрузка' && pContainer.id !== 'otgruzkaProblemsContainer') return;
            if (currentZone !== 'Отгрузка' && pContainer.id === 'otgruzkaProblemsContainer') return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'option-btn';
            btn.setAttribute('data-problem', prob);

            // Получаем иконку и стиль для проблемы
            const meta = PROBLEM_METADATA[prob] || { icon: '⚠️', class: '' };
            if (meta.class) btn.classList.add(meta.class);

            btn.innerHTML = `<span class="option-icon">${meta.icon}</span> ${prob}`;

            btn.addEventListener('click', () => {
                // Снимаем выделение во всех контейнерах проблем
                document.querySelectorAll('.option-btn').forEach(b => {
                    if (b.getAttribute('data-problem') === prob) {
                        b.classList.add('selected');
                    } else {
                        b.classList.remove('selected');
                    }
                });
                selectedProblem = prob;
            });
            pContainer.appendChild(btn);
        });
    });

    // 2. Рендерим кнопки решений (действий)
    const actionContainers = [
        document.getElementById('actionsContainer'),
        document.getElementById('byOrderActionsContainer'),
        document.getElementById('potovarkaActionsContainer'),
        document.getElementById('otgruzkaActionsContainer')
    ];

    actionContainers.forEach(aContainer => {
        if (!aContainer) return;
        aContainer.innerHTML = '';

        let currentActions = actionsList;
        if (currentZone === 'Отгрузка') {
            currentActions = [
                { id: 'resolved', name: 'Решено', icon: '✅', class: 'act-resolved' },
                { id: 'surplus', name: 'Излишка', icon: '➕', class: 'act-surplus' }
            ];
        }

        currentActions.forEach(act => {
            // Фильтруем контейнеры
            if (currentZone === 'Отгрузка' && aContainer.id !== 'otgruzkaActionsContainer') return;
            if (currentZone !== 'Отгрузка' && aContainer.id === 'otgruzkaActionsContainer') return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'action-submit-btn';
            if (act.class) btn.classList.add(act.class);
            btn.innerHTML = `<span class="action-icon">${act.icon}</span> ${act.name}`;

            btn.addEventListener('click', () => {
                submitRecord(act.name);
            });

            aContainer.appendChild(btn);
        });
    });
}

// --- ОТПРАВКА ДАННЫХ В GOOGLE ТАБЛИЦУ ---
function submitRecord(actionName, isConfirmed = false) {
    // 1. Валидация
    if (currentZone === 'Позаказная') {
        if (!selectedProblem) {
            playSound('error');
            updateStatus('Выберите проблему из списка!', 'error');
            const container = document.getElementById('byOrderProblemsContainer');
            if (container) {
                container.style.boxShadow = '0 0 10px rgba(255, 61, 113, 0.3)';
                setTimeout(() => container.style.boxShadow = '', 1000);
            }
            return;
        }
    } else if (currentZone === 'Потоварка') {
        if (!validatePotovarkaInputs()) {
            playSound('error');
            updateStatus('Данные введены некорректно!', 'error');
            return;
        }
        if (!selectedProblem) {
            playSound('error');
            updateStatus('Выберите проблему из списка!', 'error');
            const container = document.getElementById('potovarkaProblemsContainer');
            if (container) {
                container.style.boxShadow = '0 0 10px rgba(255, 61, 113, 0.3)';
                setTimeout(() => container.style.boxShadow = '', 1000);
            }
            return;
        }
    } else if (currentZone === 'Отгрузка') {
        if (!validateOtgruzkaInputs()) {
            playSound('error');
            updateStatus('Данные введены некорректно!', 'error');
            return;
        }
        if (!selectedProblem) {
            playSound('error');
            updateStatus('Выберите проблему из списка!', 'error');
            const container = document.getElementById('otgruzkaProblemsContainer');
            if (container) {
                container.style.boxShadow = '0 0 10px rgba(255, 61, 113, 0.3)';
                setTimeout(() => container.style.boxShadow = '', 1000);
            }
            return;
        }

        if (actionName === 'Решено') {
            const extraPanel = document.getElementById('otgruzkaExtraInputs');
            if (extraPanel.style.display !== 'block') {
                extraPanel.style.display = 'block';
                document.getElementById('otgruzkaOrderInput').focus();

                document.querySelectorAll('#otgruzkaActionsContainer .action-submit-btn').forEach(btn => {
                    if (btn.textContent.includes('Решено')) {
                        btn.classList.add('selected');
                    } else {
                        btn.classList.remove('selected');
                    }
                });

                updateStatus('Введите Номер заказа или Номер ГМ', 'warning');
                return;
            } else {
                if (!validateOtgruzkaExtraInputs()) {
                    return;
                }
            }
        } else {
            const extraPanel = document.getElementById('otgruzkaExtraInputs');
            extraPanel.style.display = 'none';
            document.getElementById('otgruzkaOrderInput').value = '';
            document.getElementById('otgruzkaGmInput').value = '';
        }
    } else {
        if (!validateBarcode()) {
            playSound('error');
            updateStatus('Штрих-код введен не корректно!', 'error');
            return;
        }
        if (!selectedProblem) {
            playSound('error');
            updateStatus('Выберите проблему из списка!', 'error');
            const container = document.getElementById('problemsContainer');
            if (container) {
                container.style.boxShadow = '0 0 10px rgba(255, 61, 113, 0.3)';
                setTimeout(() => container.style.boxShadow = '', 1000);
            }
            return;
        }
    }

    let barcode, qty, boxCode, orderId, inputType, gmNumber = '';
    if (currentZone === 'Позаказная') {
        boxCode = document.getElementById('byOrderBoxInput').value.trim();
        inputType = currentPozakaznayaSubtype;

        // Если полей ввода товара и заказа есть корректные данные, но они не были добавлены, добавим
        const itemVal = document.getElementById('byOrderItemInput').value.trim();
        const orderVal = document.getElementById('byOrderOrderInput').value.trim();
        const isItemValid = /^\d{13}$/.test(itemVal);
        const isOrderValid = validateOrderFormat(orderVal);
        if (isItemValid && isOrderValid) {
            addCurrentItemToList();
        }

        if (addedItems.length === 0) {
            playSound('error');
            updateStatus('Добавьте хотя бы один товар в короб!', 'error');
            return;
        }
    } else if (currentZone === 'Потоварка') {
        barcode = document.getElementById('potovarkaItemInput').value.trim();
        boxCode = document.getElementById('potovarkaBoxInput').value.trim();
        qty = parseInt(document.getElementById('potovarkaQtyInput').value) || 1;
        orderId = '';
        inputType = 'Потоварка';
    } else if (currentZone === 'Отгрузка') {
        barcode = document.getElementById('otgruzkaItemInput').value.trim();
        boxCode = '';
        qty = parseInt(document.getElementById('otgruzkaQtyInput').value) || 1;
        orderId = document.getElementById('otgruzkaOrderInput').value.trim();
        gmNumber = document.getElementById('otgruzkaGmInput').value.trim();
        inputType = 'Отгрузка';
    } else {
        barcode = document.getElementById('barcodeInput').value.trim();
        qty = parseInt(document.getElementById('qtyInput').value) || 1;
        boxCode = '';
        orderId = '';
        inputType = currentInputType === 'item' ? 'Товар' : 'Короб';
    }

    // Если еще не подтверждено пользователем, показываем окно подтверждения
    if (!isConfirmed) {
        pendingSubmitAction = actionName;
        showConfirmModal({
            zone: currentZone,
            boxCode: boxCode,
            barcode: barcode,
            orderId: orderId,
            gmNumber: gmNumber,
            problem: selectedProblem,
            action: actionName,
            qty: qty
        });
        return;
    }

    // Скрываем модальное окно, если оно было открыто
    closeConfirmModal();

    updateStatus('Отправка в Google Таблицу...', 'loading');
    toggleFormControls(true);

    if (currentZone === 'Позаказная') {
        // Отправка нескольких записей (позаказка)
        const promises = addedItems.map(item => {
            const recordData = {
                employeeId: currentUser.id,
                employeeName: currentUser.name,
                zone: currentZone,
                inputType: inputType,
                barcode: item.barcode,
                boxCode: boxCode,
                orderId: item.orderId,
                problem: selectedProblem,
                qty: item.qty,
                action: actionName
            };

            if (CONFIG.isDemoMode) {
                return new Promise(resolve => {
                    setTimeout(() => {
                        const localLogs = JSON.parse(localStorage.getItem('demo_logs') || '[]');
                        const newLog = {
                            timestamp: new Date().toLocaleString('ru-RU'),
                            barcode: item.barcode,
                            inputType: recordData.inputType,
                            problem: selectedProblem,
                            qty: item.qty,
                            action: actionName,
                            boxCode: boxCode,
                            orderId: item.orderId
                        };
                        localLogs.unshift(newLog);
                        localStorage.setItem('demo_logs', JSON.stringify(localLogs.slice(0, 50)));
                        resolve({ success: true });
                    }, 150);
                });
            } else {
                return fetch(CONFIG.apiHostUrl, {
                    method: 'POST',
                    mode: 'cors',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        action: 'addRecord',
                        employeeId: recordData.employeeId,
                        employeeName: recordData.employeeName,
                        employeeShift: currentUser.shift || "",
                        zone: recordData.zone,
                        inputType: recordData.inputType,
                        barcode: recordData.barcode,
                        problem: recordData.problem,
                        qty: recordData.qty,
                        actionTaken: recordData.action,
                        boxCode: recordData.boxCode,
                        orderId: recordData.orderId
                    })
                }).then(response => response.json());
            }
        });

        Promise.all(promises)
            .then(results => {
                toggleFormControls(false);
                const allSuccess = results.every(r => r.success);
                if (allSuccess) {
                    playSound('success');
                    updateStatus('Все записи успешно сохранены в Google Sheets!', 'success');

                    // Очищаем добавленные во временный список товары
                    addedItems = [];
                    renderAddedItemsList();

                    resetFormAfterSubmit();
                    loadHistory();
                } else {
                    playSound('error');
                    updateStatus('Часть записей не удалось сохранить.', 'error');
                }
            })
            .catch(err => {
                toggleFormControls(false);
                playSound('error');
                updateStatus('Ошибка сети при отправке записей.', 'error');
                console.error('Ошибка записи:', err);
            });
    } else {
        // Обычная отправка (остальные зоны)
        const recordData = {
            employeeId: currentUser.id,
            employeeName: currentUser.name,
            zone: currentZone,
            inputType: inputType,
            barcode: barcode,
            boxCode: boxCode,
            orderId: orderId,
            gmNumber: gmNumber,
            problem: selectedProblem,
            qty: qty,
            action: actionName
        };

        if (CONFIG.isDemoMode) {
            setTimeout(() => {
                const localLogs = JSON.parse(localStorage.getItem('demo_logs') || '[]');
                const newLog = {
                    timestamp: new Date().toLocaleString('ru-RU'),
                    barcode: barcode,
                    inputType: recordData.inputType,
                    problem: selectedProblem,
                    qty: qty,
                    action: actionName,
                    boxCode: boxCode,
                    orderId: orderId,
                    gmNumber: gmNumber
                };
                localLogs.unshift(newLog);
                localStorage.setItem('demo_logs', JSON.stringify(localLogs.slice(0, 50)));

                playSound('success');
                updateStatus('Успешно сохранено (Демо-режим)', 'success');
                toggleFormControls(false);
                resetFormAfterSubmit();
                loadHistory();
            }, 600);
        } else {
            fetch(CONFIG.apiHostUrl, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    action: 'addRecord',
                    employeeId: recordData.employeeId,
                    employeeName: recordData.employeeName,
                    employeeShift: currentUser.shift || "",
                    zone: recordData.zone,
                    inputType: recordData.inputType,
                    barcode: recordData.barcode,
                    problem: recordData.problem,
                    qty: recordData.qty,
                    actionTaken: recordData.action,
                    boxCode: recordData.boxCode,
                    orderId: recordData.orderId,
                    gmNumber: recordData.gmNumber
                })
            })
                .then(response => response.json())
                .then(data => {
                    toggleFormControls(false);
                    if (data.success) {
                        playSound('success');
                        updateStatus('Запись успешно отправлена в Google Sheets!', 'success');
                        resetFormAfterSubmit();
                        loadHistory();
                    } else {
                        playSound('error');
                        updateStatus(data.message || 'Ошибка сохранения', 'error');
                    }
                })
                .catch(err => {
                    toggleFormControls(false);
                    playSound('error');
                    updateStatus(' Ошибка подключения к серверу', 'error');
                    console.error('Ошибка записи:', err);
                });
        }
    }
}

// Управление состоянием полей во время отправки
function toggleFormControls(disable) {
    document.querySelectorAll('#recordForm input, #recordForm button').forEach(el => {
        el.disabled = disable;
    });
}

function updateStatus(text, type) {
    const alertEl = document.getElementById('statusAlert');
    alertEl.className = 'status-alert ' + (type || '');
    alertEl.textContent = text;
}

function resetLoggingForm(keepBoxCode = false) {
    if (currentZone === 'Позаказная') {
        resetByOrderForm(keepBoxCode);
    } else if (currentZone === 'Потоварка') {
        resetPotovarkaForm(keepBoxCode);
    } else if (currentZone === 'Отгрузка') {
        resetOtgruzkaForm();
    } else {
        const barcodeInput = document.getElementById('barcodeInput');
        barcodeInput.value = '';
        document.getElementById('qtyInput').value = '1';

        // Сбросить выбор проблемы
        selectedProblem = null;
        document.querySelectorAll('#problemsContainer .option-btn').forEach(btn => {
            btn.classList.remove('selected');
        });

        clearBarcodeError();
        updateStatus('Готов к сканированию', '');
    }
}

function resetPotovarkaForm(keepBoxCode = false) {
    const itemInput = document.getElementById('potovarkaItemInput');
    const boxInput = document.getElementById('potovarkaBoxInput');
    const qtyInput = document.getElementById('potovarkaQtyInput');
    if (itemInput) itemInput.value = '';
    if (qtyInput) qtyInput.value = '1';

    if (!keepBoxCode && boxInput) {
        boxInput.value = '';
    }

    selectedProblem = null;
    document.querySelectorAll('#potovarkaProblemsContainer .option-btn').forEach(btn => {
        btn.classList.remove('selected');
    });

    clearPotovarkaErrors();
    updateStatus('Готов к работе', '');
}

function validatePotovarkaInputs() {
    const itemInput = document.getElementById('potovarkaItemInput');
    const boxInput = document.getElementById('potovarkaBoxInput');
    const itemGroup = document.getElementById('potovarkaItemGroup');
    const boxGroup = document.getElementById('potovarkaBoxGroup');
    const itemError = document.getElementById('potovarkaItemError');
    const boxError = document.getElementById('potovarkaBoxError');

    let isValid = true;

    const itemVal = itemInput.value.trim();
    const isItemVal = /^\d{13}$/.test(itemVal);
    if (!isItemVal) {
        itemGroup.classList.add('invalid');
        itemError.textContent = 'ШК товара введен не правильно';
        isValid = false;
    } else {
        itemGroup.classList.remove('invalid');
        itemError.textContent = '';
    }

    const boxVal = boxInput.value.trim();
    const isBoxVal = (boxVal.startsWith('80-') && boxVal.length === 13) || boxVal === 'Короб не определен';
    if (!isBoxVal) {
        boxGroup.classList.add('invalid');
        boxError.textContent = 'ШК короба введен не правильно';
        isValid = false;
    } else {
        boxGroup.classList.remove('invalid');
        boxError.textContent = '';
    }

    return isValid;
}

function clearPotovarkaErrors() {
    const itemGroup = document.getElementById('potovarkaItemGroup');
    const boxGroup = document.getElementById('potovarkaBoxGroup');
    const itemError = document.getElementById('potovarkaItemError');
    const boxError = document.getElementById('potovarkaBoxError');
    if (itemGroup) itemGroup.classList.remove('invalid');
    if (boxGroup) boxGroup.classList.remove('invalid');
    if (itemError) itemError.textContent = '';
    if (boxError) boxError.textContent = '';
}

function resetOtgruzkaForm() {
    const itemInput = document.getElementById('otgruzkaItemInput');
    const qtyInput = document.getElementById('otgruzkaQtyInput');
    const orderInput = document.getElementById('otgruzkaOrderInput');
    const gmInput = document.getElementById('otgruzkaGmInput');

    if (itemInput) itemInput.value = '';
    if (qtyInput) qtyInput.value = '1';
    if (orderInput) orderInput.value = '';
    if (gmInput) gmInput.value = '';

    // Сбросить выбор проблемы
    selectedProblem = null;
    document.querySelectorAll('#otgruzkaProblemsContainer .option-btn').forEach(btn => {
        btn.classList.remove('selected');
    });

    // Скрыть доп. поля по умолчанию
    const extraPanel = document.getElementById('otgruzkaExtraInputs');
    if (extraPanel) extraPanel.style.display = 'none';

    clearOtgruzkaErrors();
    updateStatus('Готов к работе', '');
}

function validateOtgruzkaInputs() {
    const itemInput = document.getElementById('otgruzkaItemInput');
    const itemGroup = document.getElementById('otgruzkaItemGroup');
    const itemError = document.getElementById('otgruzkaItemError');

    let isValid = true;

    // 1. ШК товара
    const itemVal = itemInput.value.trim();
    const isItemVal = /^\d{13}$/.test(itemVal);
    if (!isItemVal) {
        itemGroup.classList.add('invalid');
        itemError.textContent = 'ШК товара введен не правильно';
        isValid = false;
    } else {
        itemGroup.classList.remove('invalid');
        itemError.textContent = '';
    }

    return isValid;
}

function validateOtgruzkaExtraInputs() {
    const orderInput = document.getElementById('otgruzkaOrderInput');
    const gmInput = document.getElementById('otgruzkaGmInput');
    const orderGroup = document.getElementById('otgruzkaOrderGroup');
    const gmGroup = document.getElementById('otgruzkaGmGroup');
    const orderError = document.getElementById('otgruzkaOrderError');
    const gmError = document.getElementById('otgruzkaGmError');

    const orderVal = orderInput.value.trim();
    const gmVal = gmInput.value.trim();

    let isValid = true;

    // Сброс старых ошибок
    if (orderGroup) orderGroup.classList.remove('invalid');
    if (gmGroup) gmGroup.classList.remove('invalid');
    if (orderError) orderError.textContent = '';
    if (gmError) gmError.textContent = '';

    // Должно быть заполнено хотя бы одно из двух полей
    if (orderVal === '' && gmVal === '') {
        playSound('error');
        if (orderGroup) orderGroup.classList.add('invalid');
        if (gmGroup) gmGroup.classList.add('invalid');
        if (orderError) orderError.textContent = 'Заполните Номер заказа или Номер ГМ';
        if (gmError) gmError.textContent = 'Заполните Номер заказа или Номер ГМ';
        isValid = false;
    } else {
        // Если номер заказа введен, он должен начинаться с 10- и быть длиной >= 4
        if (orderVal !== '') {
            const isOrderValid = validateOrderFormat(orderVal);
            if (!isOrderValid) {
                playSound('error');
                if (orderGroup) orderGroup.classList.add('invalid');
                if (orderError) orderError.textContent = 'Формат заказа неверный (должен начинаться на 10- и не содержать русские буквы)';
                isValid = false;
            }
        }
    }

    return isValid;
}

function clearOtgruzkaErrors() {
    const itemGroup = document.getElementById('otgruzkaItemGroup');
    const orderGroup = document.getElementById('otgruzkaOrderGroup');
    const gmGroup = document.getElementById('otgruzkaGmGroup');
    const itemError = document.getElementById('otgruzkaItemError');
    const orderError = document.getElementById('otgruzkaOrderError');
    const gmError = document.getElementById('otgruzkaGmError');

    if (itemGroup) itemGroup.classList.remove('invalid');
    if (orderGroup) orderGroup.classList.remove('invalid');
    if (gmGroup) gmGroup.classList.remove('invalid');
    if (itemError) itemError.textContent = '';
    if (orderError) orderError.textContent = '';
    if (gmError) gmError.textContent = '';
}

function resetFormAfterSubmit() {
    // В потоварке и отгрузке короб не сохраняем (сбрасываем оба поля по ТЗ)
    const keepBox = currentZone === 'Позаказная';
    resetLoggingForm(keepBox);

    if (currentZone === 'Позаказная') {
        document.getElementById('recordForm').setAttribute('data-flow-mode', 'by-order-acceptance');
        setTimeout(() => {
            const input = document.getElementById('byOrderItemInput');
            if (input) input.focus();
        }, 100);
    } else {
        focusBarcode();
    }
}

// --- ИСТОРИЯ ЗАПИСЕЙ ---
function loadHistory() {
    const historyList = document.getElementById('historyList');

    if (CONFIG.isDemoMode) {
        const localLogs = JSON.parse(localStorage.getItem('demo_logs') || '[]');
        renderHistoryItems(localLogs);
    } else {
        // Подгружаем историю сотрудника с сервера Google Sheets
        fetch(CONFIG.apiHostUrl + `?action=getHistory&employeeId=${currentUser.id}`)
            .then(response => response.json())
            .then(data => {
                if (data.success && data.logs) {
                    renderHistoryItems(data.logs);
                }
            })
            .catch(err => {
                console.warn('Не удалось загрузить историю с сервера', err);
            });
    }
}

function renderHistoryItems(logs) {
    const historyList = document.getElementById('historyList');
    if (!logs || logs.length === 0) {
        historyList.innerHTML = '<div class="history-empty">Здесь будут отображаться отсканированные вами товары</div>';
        return;
    }

    historyList.innerHTML = '';
    logs.slice(0, 10).forEach(log => {
        const item = document.createElement('div');
        item.className = 'history-item';

        // Разделяем время для вывода
        const timeParts = log.timestamp ? log.timestamp.split(/[\s,]+/) : [];
        const timeStr = timeParts.length > 1 ? timeParts[1] : (log.timestamp || '');

        let metaHtml = `<span class="history-badge">${log.inputType || 'Товар'}</span>`;
        if (log.inputType === 'Позаказная' || log.boxCode || log.orderId || log.gmNumber) {
            let details = [];
            if (log.boxCode) details.push(`К: ${log.boxCode}`);
            if (log.orderId) details.push(`З: ${log.orderId}`);
            if (log.gmNumber) details.push(`ГМ: ${log.gmNumber}`);
            metaHtml += ` <span style="font-weight:600; color:var(--accent-color);">${details.join(' | ')}</span>`;
        }
        metaHtml += ` <span>${log.problem} (x${log.qty})</span>`;

        item.innerHTML = `
            <div class="history-item-details">
                <div class="history-barcode">${log.barcode}</div>
                <div class="history-meta">
                    ${metaHtml}
                </div>
            </div>
            <div class="history-action-badge">${log.action || log.actionTaken}</div>
        `;
        historyList.appendChild(item);
    });
}

// --- ОКНО ПОДТВЕРЖДЕНИЯ (MODAL UI) ---
function showConfirmModal(data) {
    document.getElementById('confirmZone').textContent = data.zone;

    const boxRow = document.getElementById('confirmBox').parentElement;
    if (data.boxCode) {
        document.getElementById('confirmBox').textContent = data.boxCode;
        boxRow.classList.remove('hidden');
    } else {
        boxRow.classList.add('hidden');
    }

    const confirmItemRow = document.getElementById('confirmItemRow');
    const confirmOrderRow = document.getElementById('confirmOrderRow');
    const confirmQtyRow = document.getElementById('confirmQtyRow');
    const confirmItemsListRow = document.getElementById('confirmItemsListRow');

    if (data.zone === 'Позаказная') {
        confirmItemRow.classList.add('hidden');
        confirmOrderRow.classList.add('hidden');
        confirmQtyRow.classList.add('hidden');
        confirmItemsListRow.classList.remove('hidden');

        const listContainer = document.getElementById('confirmItemsList');
        listContainer.innerHTML = '';
        addedItems.forEach(item => {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.justify = 'space-between';
            div.innerHTML = `
                <span>🏷️ <b>${item.barcode}</b> (Заказ: ${item.orderId})</span>
                <span>x${item.qty} шт</span>
            `;
            listContainer.appendChild(div);
        });
    } else {
        confirmItemRow.classList.remove('hidden');
        confirmQtyRow.classList.remove('hidden');
        confirmItemsListRow.classList.add('hidden');

        document.getElementById('confirmItem').textContent = data.barcode;
        document.getElementById('confirmQty').textContent = data.qty;

        if (data.orderId) {
            document.getElementById('confirmOrder').textContent = data.orderId;
            confirmOrderRow.classList.remove('hidden');
        } else {
            confirmOrderRow.classList.add('hidden');
        }
    }

    const confirmGmRow = document.getElementById('confirmGmRow');
    if (confirmGmRow) {
        if (data.gmNumber) {
            document.getElementById('confirmGm').textContent = data.gmNumber;
            confirmGmRow.classList.remove('hidden');
        } else {
            confirmGmRow.classList.add('hidden');
        }
    }

    const probMeta = PROBLEM_METADATA[data.problem] || { icon: '⚠️' };
    document.getElementById('confirmProblem').textContent = `${probMeta.icon} ${data.problem}`;

    const actMeta = actionsList.find(a => a.name === data.action) || { icon: '⚙️' };
    document.getElementById('confirmAction').textContent = `${actMeta.icon} ${data.action}`;

    document.getElementById('confirmModal').classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
    pendingSubmitAction = null;
}

// --- УПРАВЛЕНИЕ СПИСКОМ ТОВАРОВ В ПОЗАКАЗКЕ ---
function addCurrentItemToList() {
    const boxInput = document.getElementById('byOrderBoxInput');
    const itemInput = document.getElementById('byOrderItemInput');
    const orderInput = document.getElementById('byOrderOrderInput');
    const qtyInput = document.getElementById('byOrderQtyInput');

    const boxVal = boxInput.value.trim();
    const itemVal = itemInput.value.trim();
    const orderVal = orderInput.value.trim();
    const qtyVal = parseInt(qtyInput.value) || 1;

    const validity = checkByOrderInputsValidity();
    if (!validity.isBoxValid) {
        playSound('error');
        document.getElementById('byOrderBoxGroup').classList.add('invalid');
        document.getElementById('byOrderBoxError').textContent = 'ШК короба введен не правильно';
        return false;
    }
    if (!validity.isItemValid) {
        playSound('error');
        document.getElementById('byOrderItemGroup').classList.add('invalid');
        document.getElementById('byOrderItemError').textContent = 'ШК товара введен не правильно';
        return false;
    }
    if (!validity.isOrderValid) {
        playSound('error');
        document.getElementById('byOrderOrderGroup').classList.add('invalid');
        document.getElementById('byOrderOrderError').textContent = 'Номер заказа введен не правильно';
        return false;
    }

    // Проверим дубликаты
    const exists = addedItems.some(i => i.barcode === itemVal && i.orderId === orderVal);
    if (exists) {
        playSound('error');
        updateStatus('Этот товар с таким заказом уже добавлен!', 'error');
        return false;
    }

    addedItems.push({
        barcode: itemVal,
        orderId: orderVal,
        qty: qtyVal
    });

    playSound('success');

    // Очищаем поля ввода товара и заказа
    itemInput.value = '';
    orderInput.value = '';
    qtyInput.value = '1';

    renderAddedItemsList();

    // Возвращаем фокус на поле ввода товара
    itemInput.focus();

    clearByOrderErrors();
    checkByOrderInputsValidity();

    updateStatus('Товар успешно добавлен в список', 'success');
    return true;
}

function renderAddedItemsList() {
    const listGroup = document.getElementById('byOrderItemsListGroup');
    const listContainer = document.getElementById('byOrderItemsList');

    if (addedItems.length === 0) {
        listGroup.classList.add('hidden');
        listContainer.innerHTML = '';
        return;
    }

    listGroup.classList.remove('hidden');
    listContainer.innerHTML = '';

    addedItems.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'added-item-row';
        row.innerHTML = `
            <div class="added-item-details">
                <span class="added-item-barcode">${item.barcode}</span>
                <span class="added-item-meta">Заказ: ${item.orderId} | Кол-во: ${item.qty} шт</span>
            </div>
            <button type="button" class="added-item-remove" data-index="${index}">🗑️</button>
        `;

        row.querySelector('.added-item-remove').addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            addedItems.splice(idx, 1);
            playSound('success');
            renderAddedItemsList();
            checkByOrderInputsValidity();
        });

        listContainer.appendChild(row);
    });
}
