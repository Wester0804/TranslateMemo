// background.js - Service Worker for Manifest V3

// Service Worker 啟動時建立右鍵選單
chrome.contextMenus.removeAll(function() {
    chrome.contextMenus.create({
        id: 'translateSelectedText',
        title: '翻譯選取文字',
        contexts: ['selection']
    });
    
    chrome.contextMenus.create({
        id: 'openTranslator',
        title: '開啟翻譯工具',
        contexts: ['page']
    });
});

// 安裝事件
chrome.runtime.onInstalled.addListener(function() {
    // 建立右鍵選單
    chrome.contextMenus.removeAll(function() {
        chrome.contextMenus.create({
            id: 'translateSelectedText',
            title: '翻譯選取文字',
            contexts: ['selection']
        });
        
        chrome.contextMenus.create({
            id: 'openTranslator',
            title: '開啟翻譯工具',
            contexts: ['page']
        });
    });
    
    // 初始化設定
    chrome.storage.sync.set({
        highlightEnabled: true,
        autoTranslate: true,
        highlightColor: '#FFEB3B',
        targetLanguage: 'zh-TW',
        disableOnGoogle: true
    });
    
    // 初始化本地儲存
    chrome.storage.local.get(['translations'], function(result) {
        if (!result.translations) {
            chrome.storage.local.set({translations: {}});
        }
    });
});

// 監聽來自 popup 或 content script 的訊息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'translate') {
        handleTranslateText(request.text, request.targetLang).then(function(result) {
            sendResponse(result);
        }).catch(function(error) {
            sendResponse({error: error.message});
        });
        return true;
    }
    
    if (request.action === 'updateBadge') {
        updateBadgeCount();
    }
    
    if (request.action === 'saveTranslation') {
        saveTranslation(request.original, request.translation);
    }
});

// 翻譯文字
async function handleTranslateText(text, targetLang = 'zh-TW') {
    if (!text || text.trim() === '') {
        throw new Error('文字不能為空');
    }
    
    try {
        const translation = await translateText(text, targetLang);
        return {
            original: text,
            translation: translation,
            targetLang: targetLang
        };
    } catch (error) {
        console.error('翻譯失敗:', error);
        throw error;
    }
}

// 使用 Google Translate API 翻譯
async function translateText(text, targetLang) {
    const encodedText = encodeURIComponent(text);
    const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang.toLowerCase()}&dt=t&q=${encodedText}`;
    
    try {
        const response = await fetch(apiUrl);
        
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data || !data[0] || !data[0][0] || !data[0][0][0]) {
            throw new Error('無效的翻譯回應格式');
        }
        
        const translation = data[0].map(item => item[0]).join('');
        return translation;
        
    } catch (error) {
        console.error('翻譯API錯誤:', error);
        throw new Error('翻譯服務暫時無法使用');
    }
}

// 更新徽章計數
function updateBadgeCount() {
    chrome.storage.local.get(['translations'], function(result) {
        const translations = result.translations || {};
        const count = Object.keys(translations).length;
        
        chrome.action.setBadgeText({
            text: count > 0 ? count.toString() : ''
        });
        
        chrome.action.setBadgeBackgroundColor({
            color: '#4CAF50'
        });
    });
}

// 儲存翻譯到本地存儲
function saveTranslation(original, translation) {
    const normalizedOriginal = original.toLowerCase().trim();
    
    chrome.storage.local.get(['translations', 'todayTranslations'], function(result) {
        const translations = result.translations || {};
        const todayTranslations = result.todayTranslations || {};
        const today = new Date().toDateString();
        
        if (translations[normalizedOriginal]) {
            translations[normalizedOriginal].count++;
            translations[normalizedOriginal].timestamp = Date.now();
        } else {
            translations[normalizedOriginal] = {
                translation: translation,
                timestamp: Date.now(),
                count: 1
            };
            
            todayTranslations[today] = (todayTranslations[today] || 0) + 1;
        }
        
        chrome.storage.local.set({
            translations: translations,
            todayTranslations: todayTranslations
        }, function() {
            updateBadgeCount();
            
            // 通知所有標籤頁更新
            chrome.tabs.query({}, function(tabs) {
                tabs.forEach(tab => {
                    try {
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'updateTranslations',
                            translations: translations
                        });
                    } catch (error) {
                        // 忽略無法發送訊息的標籤頁
                    }
                });
            });
        });
    });
}

// 監聽 storage 變化
chrome.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'local' && changes.translations) {
        updateBadgeCount();
    }
});

// 右鍵選單點擊事件
chrome.contextMenus.onClicked.addListener(function(info, tab) {
    if (info.menuItemId === 'translateSelectedText') {
        const selectedText = info.selectionText;
        if (selectedText) {
            // 儲存選取的文字到 storage，供 popup 使用
            chrome.storage.local.set({
                pendingTranslation: {
                    text: selectedText,
                    timestamp: Date.now()
                }
            }, function() {
                // 嘗試開啟 popup
                try {
                    chrome.action.openPopup();
                } catch (error) {
                    // 如果無法自動開啟 popup，發送通知
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'showNotification',
                        text: '請點擊擴充功能圖示查看翻譯結果'
                    });
                }
            });
        }
    } else if (info.menuItemId === 'openTranslator') {
        try {
            chrome.action.openPopup();
        } catch (error) {
            console.log('無法開啟 popup');
        }
    }
});

// 初始化徽章計數
updateBadgeCount();
