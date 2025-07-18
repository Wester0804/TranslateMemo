// background.js
chrome.runtime.onInstalled.addListener(function() {
    // 初始化設定
    chrome.storage.sync.set({
        highlightEnabled: true,
        autoTranslate: false,
        highlightColor: '#FFEB3B',
        translationLanguage: 'zh-TW'
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

// 監聽來自 content script 的訊息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'updateBadge') {
        updateBadge(request.count);
    } else if (request.action === 'translateText') {
        translateText(request.text, request.targetLang)
            .then(result => {
                sendResponse({success: true, translation: result});
            })
            .catch(error => {
                sendResponse({success: false, error: error.message});
            });
        return true; // 保持消息通道開啟
    } else if (request.action === 'saveTranslation') {
        saveTranslation(request.original, request.translation, request.context);
        sendResponse({success: true});
    } else if (request.action === 'getTranslations') {
        getTranslations().then(translations => {
            sendResponse({success: true, translations: translations});
        });
        return true;
    } else if (request.action === 'checkHighlightWords') {
        checkHighlightWords(request.text).then(words => {
            sendResponse({success: true, words: words});
        });
        return true;
    }
});

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

// 翻譯文字功能
async function translateText(text, targetLang = 'zh-TW') {
    // 這裡使用 Google Translate API 或其他翻譯服務
    // 由於需要 API 密鑰，這裡提供一個示例結構
    try {
        const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`);
        const data = await response.json();
        
        if (data && data[0] && data[0][0] && data[0][0][0]) {
            return data[0][0][0];
        }
        throw new Error('翻譯失敗');
    } catch (error) {
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