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
        targetLanguage: 'zh-TW',
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
        const { text, targetLang = 'zh-TW' } = request;
        console.log(`開始翻譯: "${text}" -> ${targetLang}`);
        
        // 正規化語言代碼 (Google Translate API 偏好小寫)
        const normalizedLang = targetLang.toLowerCase();
        
        // 使用 Google Translate 非官方 API
        const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(normalizedLang)}&dt=t&q=${encodeURIComponent(text)}`;
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
