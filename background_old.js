// background.js - Service Worker for Manifest V3
console.log('Background Service Worker 啟動');

// 安裝事件
chrome.runtime.onInstalled.addListener(function() {
    console.log('擴充功能已安裝');
    
    // 初始化設定
    chrome.storage.sync.set({
        highlightEnabled: true,
        autoTranslate: true,
        highlightColor: '#FFEB3B',
        targetLanguage: 'en',  // 預設翻譯為英文
        disableOnGoogle: true
    });
    
    // 初始化本地儲存
    chrome.storage.local.get(['translations'], function(result) {
        if (!result.translations) {
            chrome.storage.local.set({
                translations: {},
                todayTranslations: {},
                translationStats: {
                    totalWords: 0,
                    totalTranslations: 0,
                    streak: 0,
                    lastDate: null
                }
            });
        }
    });
});

// 監聽來自 popup 和 content script 的訊息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Service Worker 收到消息:', request);
    
    if (request.action === 'translateText') {
        console.log('處理翻譯請求:', request.text);
        handleTranslateText(request, sendResponse);
        return true; // 保持通道開啟以支援異步回應
    } 
    else if (request.action === 'updateBadge') {
        updateBadge(request.count);
        sendResponse({success: true});
    } 
    else if (request.action === 'saveTranslation') {
        saveTranslation(request.original, request.translation, request.context);
        sendResponse({success: true});
    } 
    else if (request.action === 'getTranslations') {
        getTranslations().then(translations => {
            sendResponse({success: true, translations: translations});
        });
        return true;
    } 
    else if (request.action === 'checkHighlightWords') {
        checkHighlightWords(request.text).then(words => {
            sendResponse({success: true, words: words});
        });
        return true;
    }
});

// 處理翻譯請求
async function handleTranslateText(request, sendResponse) {
    try {
        const { text, targetLang = 'en' } = request;
        console.log(`開始翻譯: "${text}" -> ${targetLang}`);
        
        // 使用 Google Translate 非官方 API
        const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
        console.log('API URL:', apiUrl);
        
        const response = await fetch(apiUrl);
        console.log('Fetch 回應狀態:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP 錯誤: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('翻譯資料:', data);
        
        if (Array.isArray(data) && data[0] && Array.isArray(data[0])) {
            const translation = data[0]
                .filter(item => item && item[0])
                .map(item => item[0])
                .join('');
            
            console.log('翻譯結果:', translation);
            sendResponse({success: true, translation: translation});
        } else {
            throw new Error('無效的翻譯回應格式');
        }
    } catch (error) {
        console.error('翻譯錯誤:', error);
        sendResponse({
            success: false, 
            error: error.message || '翻譯失敗'
        });
    }
}

// 更新擴展圖標上的徽章
function updateBadge(count) {
    console.log('更新徽章計數:', count);
    if (count > 0) {
        chrome.action.setBadgeText({
            text: count.toString()
        });
        chrome.action.setBadgeBackgroundColor({
            color: '#4CAF50'
        });
    } else {
        chrome.action.setBadgeText({
            text: ''
        });
    }
}

// 儲存翻譯功能
async function saveTranslation(original, translation, context) {
    console.log('儲存翻譯:', original, '->', translation);
    
    const translationData = {
        translation: translation,
        timestamp: Date.now(),
        count: 1,
        context: context || ''
    };
    
    try {
        const result = await chrome.storage.local.get(['translations', 'todayTranslations']);
        const translations = result.translations || {};
        const todayTranslations = result.todayTranslations || {};
        const today = new Date().toDateString();
        const normalizedOriginal = original.toLowerCase().trim();
        
        // 如果已存在，增加計數
        if (translations[normalizedOriginal]) {
            translations[normalizedOriginal].count++;
            translations[normalizedOriginal].timestamp = Date.now();
        } else {
            translations[normalizedOriginal] = translationData;
            // 更新今日翻譯計數
            todayTranslations[today] = (todayTranslations[today] || 0) + 1;
        }
        
        // 儲存到本地存儲
        await chrome.storage.local.set({
            translations: translations,
            todayTranslations: todayTranslations
        });
        
        console.log('翻譯已儲存');
    } catch (error) {
        console.error('儲存翻譯失敗:', error);
    }
}

// 取得所有翻譯
async function getTranslations() {
    try {
        const result = await chrome.storage.local.get(['translations']);
        return result.translations || {};
    } catch (error) {
        console.error('取得翻譯失敗:', error);
        return {};
    }
}

// 檢查需要標記的詞彙
async function checkHighlightWords(text) {
    try {
        const translations = await getTranslations();
        const words = [];
        
        for (const [original, data] of Object.entries(translations)) {
            if (text.toLowerCase().includes(original.toLowerCase())) {
                words.push({
                    original: original,
                    translation: data.translation
                });
            }
        }
        
        return words;
    } catch (error) {
        console.error('檢查標記詞彙失敗:', error);
        return [];
    }
}

// 更新擴展圖標上的徽章
function updateBadge(count) {
    if (count > 0) {
        chrome.action.setBadgeText({
            text: count.toString()
        });
        chrome.action.setBadgeBackgroundColor({
            color: '#4CAF50'
        });
    } else {
        chrome.action.setBadgeText({
            text: ''
        });
    }
}

// 翻譯快取
const translationCache = new Map();
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24小時

// 從快取取得翻譯
function getCachedTranslation(text, targetLang) {
    const cacheKey = `${text}:${targetLang}`;
    const cached = translationCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_EXPIRY) {
        return cached.translation;
    }
    return null;
}

// 儲存翻譯到快取
function cacheTranslation(text, targetLang, translation) {
    const cacheKey = `${text}:${targetLang}`;
    translationCache.set(cacheKey, {
        translation,
        timestamp: Date.now()
    });
}

// 翻譯文字功能
async function translateText(text, targetLang = 'en') {
    if (!text || !targetLang) {
        throw new Error('缺少必要參數');
    }
    
    try {
        console.log('開始翻譯處理:', { text, targetLang });
        
        // 檢查快取
        const cached = getCachedTranslation(text, targetLang);
        if (cached) {
            console.log('使用快取的翻譯:', cached);
            return cached;
        }
        
        console.log('未找到快取，開始新的翻譯請求');
        // 設定超時
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
            console.error('翻譯請求超時（10秒）');
        }, 10000); // 延長到10秒超時

        console.log('發送翻譯請求到 Google 翻譯');
        // 建構 Google 翻譯 URL
        const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        console.log('API URL:', apiUrl);
        
        const translateResponse = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36'
            },
            signal: controller.signal
        }).catch(error => {
            console.error('API 請求失敗:', error);
            throw new Error('無法連接翻譯服務');
        });

        console.log('收到 API 回應:', translateResponse.status);
        clearTimeout(timeout);

        if (!translateResponse.ok) {
            const errorText = await translateResponse.text().catch(() => '未知錯誤');
            console.error('API 回應錯誤:', translateResponse.status, errorText);
            throw new Error(`翻譯請求失敗 (${translateResponse.status}): ${errorText}`);
        }

        let translateData;
        try {
            translateData = await translateResponse.json();
            console.log('API 回應內容:', translateData);
        } catch (error) {
            console.error('解析 API 回應失敗:', error);
            throw new Error('無法解析翻譯結果');
        }

        // Google 翻譯 API 回傳的是一個多維陣列，第一個元素包含翻譯結果
        if (Array.isArray(translateData) && translateData[0] && Array.isArray(translateData[0])) {
            // 組合所有翻譯片段
            const translatedText = translateData[0]
                .filter(item => item && item[0])  // 過濾有效的翻譯片段
                .map(item => item[0])             // 取得翻譯文字
                .join('');                        // 組合成完整翻譯

            console.log('翻譯成功:', translatedText);
            // 儲存到快取
            cacheTranslation(text, targetLang, translatedText);
            return translatedText;
        }
        
        console.error('API 回應格式不符預期:', translateData);
        throw new Error('翻譯失敗：無法解析翻譯結果');
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('翻譯請求超時');
        }
        console.error('翻譯錯誤:', error);
        throw error;
    }
}

// 儲存翻譯記錄
function saveTranslation(original, translation, context = '') {
    const today = new Date().toDateString();
    
    chrome.storage.local.get(['translations', 'todayTranslations', 'translationStats'], function(result) {
        const translations = result.translations || {};
        const todayTranslations = result.todayTranslations || {};
        const stats = result.translationStats || {
            totalWords: 0,
            totalTranslations: 0,
            streak: 0,
            lastDate: null
        };
        
        // 儲存翻譯
        const key = original.toLowerCase().trim();
        translations[key] = {
            original: original,
            translation: translation,
            context: context,
            timestamp: Date.now(),
            count: (translations[key]?.count || 0) + 1,
            lastSeen: today
        };
        
        // 更新今日統計
        if (!todayTranslations[today]) {
            todayTranslations[today] = 0;
        }
        todayTranslations[today]++;
        
        // 更新總統計
        stats.totalWords = Object.keys(translations).length;
        stats.totalTranslations++;
        
        // 計算連續天數
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();
        if (stats.lastDate === yesterday) {
            stats.streak++;
        } else if (stats.lastDate !== today) {
            stats.streak = 1;
        }
        stats.lastDate = today;
        
        chrome.storage.local.set({
            translations: translations,
            todayTranslations: todayTranslations,
            translationStats: stats
        });
        
        // 更新徽章
        updateBadge(Object.keys(translations).length);
    });
}

// 獲取所有翻譯記錄
async function getTranslations() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['translations'], function(result) {
            resolve(result.translations || {});
        });
    });
}

// 檢查文字中是否包含已翻譯的詞彙
async function checkHighlightWords(text) {
    const translations = await getTranslations();
    const words = Object.keys(translations);
    const foundWords = [];
    
    words.forEach(word => {
        if (text.toLowerCase().includes(word.toLowerCase())) {
            foundWords.push({
                word: word,
                translation: translations[word].translation,
                original: translations[word].original
            });
        }
    });
    
    return foundWords;
}

// 定期清理舊的統計資料
function cleanupOldData() {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toDateString();
    
    chrome.storage.local.get(['todayTranslations'], function(result) {
        const todayTranslations = result.todayTranslations || {};
        const cleanedData = {};
        
        // 只保留最近一週的資料
        for (const [date, count] of Object.entries(todayTranslations)) {
            if (new Date(date) >= new Date(oneWeekAgo)) {
                cleanedData[date] = count;
            }
        }
        
        chrome.storage.local.set({
            todayTranslations: cleanedData
        });
    });
}

// 每天清理一次舊資料
chrome.alarms.create('cleanupOldData', {
    delayInMinutes: 60, // 1小時後開始
    periodInMinutes: 1440 // 每24小時重複
});

chrome.alarms.onAlarm.addListener(function(alarm) {
    if (alarm.name === 'cleanupOldData') {
        cleanupOldData();
    }
});

// 右鍵選單
chrome.runtime.onInstalled.addListener(function() {
    chrome.contextMenus.create({
        id: 'translateSelected',
        title: '翻譯選取的文字',
        contexts: ['selection']
    });
    
    chrome.contextMenus.create({
        id: 'openManager',
        title: '開啟翻譯管理器',
        contexts: ['page']
    });
});

chrome.contextMenus.onClicked.addListener(function(info, tab) {
    if (info.menuItemId === 'translateSelected') {
        // 向 content script 發送翻譯指令
        chrome.tabs.sendMessage(tab.id, {
            action: 'translateSelection',
            text: info.selectionText
        });
    } else if (info.menuItemId === 'openManager') {
        chrome.tabs.create({
            url: chrome.runtime.getURL('manager.html')
        });
    }
});

// 監聽存儲變化，更新徽章
chrome.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'local' && changes.translations) {
        const newTranslations = changes.translations.newValue || {};
        const count = Object.keys(newTranslations).length;
        updateBadge(count);
    }
});

// 檢查並初始化每日統計
function initializeDailyStats() {
    const today = new Date().toDateString();
    
    chrome.storage.local.get(['todayTranslations'], function(result) {
        const todayTranslations = result.todayTranslations || {};
        
        if (!todayTranslations[today]) {
            todayTranslations[today] = 0;
            chrome.storage.local.set({
                todayTranslations: todayTranslations
            });
        }
    });
}

// 啟動時初始化
initializeDailyStats();

// 導出翻譯資料的快捷方式
chrome.commands.onCommand.addListener(function(command) {
    if (command === 'export-translations') {
        chrome.tabs.create({
            url: chrome.runtime.getURL('manager.html')
        });
    } else if (command === 'toggle-highlight') {
        // 切換高亮顯示
        chrome.storage.sync.get(['highlightEnabled'], function(result) {
            const newState = !result.highlightEnabled;
            chrome.storage.sync.set({
                highlightEnabled: newState
            });
            
            // 通知所有標籤頁更新高亮狀態
            chrome.tabs.query({}, function(tabs) {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'updateHighlight',
                        enabled: newState
                    });
                });
            });
        });
    }
});

// 處理擴展更新
chrome.runtime.onUpdateAvailable.addListener(function(details) {
    // 儲存目前的資料
    chrome.storage.local.get(['translations'], function(result) {
        if (result.translations) {
            console.log('備份翻譯資料，共', Object.keys(result.translations).length, '個詞彙');
            
            // 可以選擇性地備份到雲端或匯出
            const backup = {
                timestamp: Date.now(),
                version: chrome.runtime.getManifest().version,
                translations: result.translations
            };
            
            // 儲存備份
            chrome.storage.local.set({
                lastBackup: backup
            });
        }
    });
});

// 擴展安裝完成後的初始化
chrome.runtime.onStartup.addListener(function() {
    initializeDailyStats();
    
    // 恢復上次的徽章狀態
    chrome.storage.local.get(['translations'], function(result) {
        const translations = result.translations || {};
        updateBadge(Object.keys(translations).length);
    });
});

// 匯出翻譯資料
function exportTranslations() {
    chrome.storage.local.get(['translations', 'translationStats'], function(result) {
        const exportData = {
            exportDate: new Date().toISOString(),
            translations: result.translations || {},
            stats: result.translationStats || {},
            version: chrome.runtime.getManifest().version
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: 'application/json'
        });
        
        const url = URL.createObjectURL(blob);
        const filename = `translations_${new Date().toISOString().split('T')[0]}.json`;
        
        chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: true
        });
    });
}

// 匯入翻譯資料
function importTranslations(jsonData) {
    try {
        const importData = JSON.parse(jsonData);
        
        if (importData.translations) {
            chrome.storage.local.get(['translations'], function(result) {
                const existingTranslations = result.translations || {};
                const mergedTranslations = { ...existingTranslations, ...importData.translations };
                
                chrome.storage.local.set({
                    translations: mergedTranslations
                });
                
                updateBadge(Object.keys(mergedTranslations).length);
                console.log('成功匯入', Object.keys(importData.translations).length, '個翻譯詞彙');
            });
        }
    } catch (error) {
        console.error('匯入失敗:', error);
    }
}

// 公開 API 給其他腳本使用
window.translationPlugin = {
    exportTranslations: exportTranslations,
    importTranslations: importTranslations
};

// 添加頁面 URL 變更監聽
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        // 擴大 Google 搜尋網址匹配範圍
        const isGoogleSearch = tab.url.includes('google.') && 
                             (tab.url.includes('/search') || 
                              tab.url.includes('?q=') || 
                              tab.url.includes('&q='));
        
        if (isGoogleSearch) {
            chrome.storage.sync.get(['disableOnGoogle'], function(result) {
                if (result.disableOnGoogle) {
                    chrome.tabs.sendMessage(tabId, {
                        action: 'toggleHighlight',
                        enabled: false
                    });
                }
            });
        } else {
            chrome.storage.sync.get(['highlightEnabled'], function(result) {
                chrome.tabs.sendMessage(tabId, {
                    action: 'toggleHighlight',
                    enabled: result.highlightEnabled
                });
            });
        }
    }
});