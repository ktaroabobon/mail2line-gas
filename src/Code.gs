/**
 * メインロジック
 * Gmail → LINE通知システム
 */

/**
 * メイン処理（トリガーから実行される）
 */
function main() {
  try {
    const config = getConfig();
    const messages = getGmailMessages(config);

    if (messages.length === 0) {
      Logger.log('新着メールはありません');
      return;
    }

    Logger.log(`${messages.length}件の新着メールを処理します`);

    // 古い順に処理
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];

      try {
        // LINE通知
        sendLineNotification(config, message);

        // 既読処理（個別メッセージのみ）
        markAsRead(message.gmailMessage);

        Logger.log(`処理完了: ${message.subject}`);
      } catch (error) {
        Logger.log(`メール処理エラー: ${message.subject} - ${error.message}`);
        // 個別エラーでも処理を継続
      }
    }

    Logger.log('全メール処理完了');
  } catch (error) {
    Logger.log(`致命的エラー: ${error.message}`);
    throw error;
  }
}

/**
 * Gmailから未読メッセージを取得
 * @param {Object} config - 設定オブジェクト
 * @returns {Array} メッセージ情報の配列
 */
function getGmailMessages(config) {
  const threads = GmailApp.search(config.GMAIL_QUERY);
  const messages = [];

  for (const thread of threads) {
    const gmailMessages = thread.getMessages();

    for (const msg of gmailMessages) {
      if (msg.isUnread()) {
        const from = msg.getFrom();
        const replyTo = msg.getReplyTo();
        const subject = msg.getSubject();

        // Garmin LiveTrackメールのみフィルタリング（返信先でチェック）
        if (!replyTo || !replyTo.includes('noreply@garmin.com')) {
          Logger.log(`スキップ: 返信先が一致しません - From: ${from}, Reply-To: ${replyTo}`);
          continue;
        }

        if (!subject.includes('LiveTrack')) {
          Logger.log(`スキップ: 件名にLiveTrackが含まれません - ${subject}`);
          continue;
        }

        messages.push({
          gmailMessage: msg,  // 個別メッセージオブジェクトを追加
          thread: thread,     // スレッドも保持（情報参照用）
          from: from,
          date: msg.getDate(),
          subject: subject,
          body: msg.getPlainBody(),
          htmlBody: msg.getBody(),
          attachmentCount: msg.getAttachments().length
        });
      }
    }
  }

  return messages;
}

/**
 * LINE Messaging APIで通知を送信
 * @param {Object} config - 設定オブジェクト
 * @param {Object} message - メッセージ情報
 */
function sendLineNotification(config, message) {
  // トークン検証ログ
  const token = config.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    Logger.log('エラー: LINE_CHANNEL_ACCESS_TOKEN が設定されていません');
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN が設定されていません');
  }
  Logger.log(`LINE トークン検証: 先頭3文字=${token.substring(0, 3)}***, 長さ=${token.length}文字`);

  // Garmin LiveTrack専用メッセージフォーマット
  const text = formatLiveTrackMessage(message);

  // グループIDが設定されている場合は各グループに個別送信
  if (config.LINE_GROUP_IDS && config.LINE_GROUP_IDS.length > 0) {
    // push API（各グループに個別送信）
    Logger.log(`push APIを使用: ${config.LINE_GROUP_IDS.length}グループに送信`);

    const results = [];

    for (const groupId of config.LINE_GROUP_IDS) {
      try {
        // push APIで単一グループに送信
        const url = 'https://api.line.me/v2/bot/message/push';
        const payload = {
          to: groupId,  // 単一のグループID
          messages: [{
            type: 'text',
            text: text
          }]
        };

        const options = {
          method: 'post',
          contentType: 'application/json',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        };

        // API呼び出し
        const response = UrlFetchApp.fetch(url, options);
        const statusCode = response.getResponseCode();
        const responseBody = response.getContentText();

        // 結果を記録
        if (statusCode >= 200 && statusCode < 300) {
          results.push({ groupId, success: true });
          Logger.log(`✓ グループ ${groupId.substring(0, 5)}*** に送信成功`);
        } else {
          results.push({ groupId, success: false, error: responseBody });
          Logger.log(`✗ グループ ${groupId.substring(0, 5)}*** に送信失敗: ${statusCode} - ${responseBody}`);
        }
      } catch (e) {
        results.push({ groupId, success: false, error: e.message });
        Logger.log(`✗ グループ ${groupId.substring(0, 5)}*** 例外発生: ${e.message}`);
      }
    }

    // 結果サマリー
    const successCount = results.filter(r => r.success).length;
    Logger.log(`📊 送信結果: ${successCount}/${config.LINE_GROUP_IDS.length}グループに成功`);

    // 全て失敗した場合のみエラー
    if (successCount === 0) {
      throw new Error('全てのグループへの送信が失敗しました');
    }

    return; // 早期リターン（broadcast処理をスキップ）
  }

  // グループIDが未設定の場合は従来通りbroadcast API（友だち全員に送信）
  Logger.log('broadcast APIを使用（後方互換モード - グループID未設定）');

  const url = 'https://api.line.me/v2/bot/message/broadcast';
  const payload = {
    messages: [{
      type: 'text',
      text: text
    }]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const statusCode = response.getResponseCode();
  const responseBody = response.getContentText();

  // 2xx系ステータスコードを成功として判定
  if (statusCode < 200 || statusCode >= 300) {
    Logger.log(`LINE API Error: ステータス=${statusCode}, レスポンス=${responseBody}`);
    throw new Error(`LINE API Error: ${statusCode} - ${responseBody}`);
  }

  // 成功時のログ
  Logger.log(`LINE API Success: ステータス=${statusCode}, レスポンス=${responseBody}`);
}

/**
 * メッセージを既読にする
 * @param {GmailMessage} gmailMessage - Gmailメッセージ
 */
function markAsRead(gmailMessage) {
  gmailMessage.markRead();
  Logger.log(`既読処理完了: Message ID ${gmailMessage.getId()}`);
}

/**
 * HTMLメール本文からLiveTrack URLを抽出
 * @param {string} htmlBody - HTMLメール本文
 * @returns {string|null} LiveTrack URL、見つからない場合はnull
 */
function extractLiveTrackUrl(htmlBody) {
  if (!htmlBody) {
    return null;
  }

  // パターン1: href属性からURL抽出
  const hrefPattern = /href=["'](https:\/\/livetrack\.garmin\.com\/session\/[^"']+)["']/i;
  const hrefMatch = htmlBody.match(hrefPattern);
  if (hrefMatch) {
    return hrefMatch[1];
  }

  // パターン2: 直接URL抽出
  const urlPattern = /(https:\/\/livetrack\.garmin\.com\/session\/[^\s<>"]+)/i;
  const urlMatch = htmlBody.match(urlPattern);
  if (urlMatch) {
    return urlMatch[1];
  }

  return null;
}

/**
 * メール本文から名前を抽出
 * @param {string} plainBody - プレーンテキストメール本文
 * @returns {string|null} 名前、見つからない場合はnull
 */
function extractNameFromBody(plainBody) {
  if (!plainBody) {
    return null;
  }

  // パターン: "XXXさんがアクティビティを開始しました" または "XXXさんが LiveTrack"
  const patterns = [
    /(.+?)さんがアクティビティを開始しました/,
    /(.+?)さんが\s*LiveTrack/,
    /(.+?)\s*さんが/
  ];

  for (const pattern of patterns) {
    const match = plainBody.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * 件名から名前を抽出（フォールバック用）
 * @param {string} subject - メール件名
 * @returns {string|null} 名前、見つからない場合はnull
 */
function extractNameFromSubject(subject) {
  if (!subject) {
    return null;
  }

  // パターン: "XXXのLiveTrackを見る" または "XXX の LiveTrack"
  const patterns = [
    /(.+?)のLiveTrackを見る/,
    /(.+?)\s*の\s*LiveTrack/i,
    /(.+?)\s*LiveTrack/i
  ];

  for (const pattern of patterns) {
    const match = subject.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Garmin LiveTrack専用のメッセージフォーマットを生成
 * @param {Object} message - メッセージ情報
 * @returns {string} フォーマット済みメッセージ
 */
function formatLiveTrackMessage(message) {
  // 名前の抽出（本文 → 件名 → フォールバック）
  let name = extractNameFromBody(message.body);
  if (!name) {
    name = extractNameFromSubject(message.subject);
  }
  if (!name) {
    name = '誰か';
  }

  // URLの抽出
  const url = extractLiveTrackUrl(message.htmlBody);

  // メッセージ組み立て
  const lines = [
    `🏃‍♂️ ${name} さんが LiveTrack を開始しました！`
  ];

  if (url) {
    lines.push('');
    lines.push('📍 リアルタイムで位置を確認:');
    lines.push(url);
    lines.push('');
    lines.push('URLをタップして応援メッセージを送ろう！💪');
  } else {
    // URLが見つからない場合は件名を表示
    lines.push('');
    lines.push(message.subject);
  }

  return lines.join('\n');
}

// ======================
// テスト関数
// ======================

/**
 * LiveTrack URL抽出のテスト
 */
function testExtractLiveTrackUrl() {
  Logger.log('=== testExtractLiveTrackUrl ===');

  const testHtml1 = '<a href="https://livetrack.garmin.com/session/abc123">Track</a>';
  Logger.log(`テスト1 (href属性): ${extractLiveTrackUrl(testHtml1)}`);

  const testHtml2 = 'URLはこちら: https://livetrack.garmin.com/session/xyz789 です';
  Logger.log(`テスト2 (直接URL): ${extractLiveTrackUrl(testHtml2)}`);

  const testHtml3 = '<p>URLがありません</p>';
  Logger.log(`テスト3 (URLなし): ${extractLiveTrackUrl(testHtml3)}`);
}

/**
 * 名前抽出のテスト
 */
function testExtractName() {
  Logger.log('=== testExtractName ===');

  const testBody = 'Keitaro Watanabeさんがアクティビティを開始しました';
  Logger.log(`テスト1 (本文): ${extractNameFromBody(testBody)}`);

  const testSubject = 'Keitaro WatanabeのLiveTrackを見る';
  Logger.log(`テスト2 (件名): ${extractNameFromSubject(testSubject)}`);

  const testBody2 = 'John Doeさんが LiveTrack を開始';
  Logger.log(`テスト3 (本文変形): ${extractNameFromBody(testBody2)}`);
}

/**
 * メッセージフォーマットのテスト
 */
function testFormatMessage() {
  Logger.log('=== testFormatMessage ===');

  const mockMessage = {
    subject: 'Keitaro WatanabeのLiveTrackを見る',
    body: 'Keitaro Watanabeさんがアクティビティを開始しました',
    htmlBody: '<a href="https://livetrack.garmin.com/session/test123">View LiveTrack</a>'
  };

  const formatted = formatLiveTrackMessage(mockMessage);
  Logger.log('フォーマット結果:');
  Logger.log(formatted);
}

/**
 * 全テストを実行
 */
function runAllTests() {
  Logger.log('========================================');
  Logger.log('Garmin LiveTrack 通知システム - テスト実行');
  Logger.log('========================================');

  testExtractLiveTrackUrl();
  Logger.log('');

  testExtractName();
  Logger.log('');

  testFormatMessage();
  Logger.log('');

  Logger.log('========================================');
  Logger.log('全テスト完了');
  Logger.log('========================================');
}

// ======================
// Webhook受信関数
// ======================

/**
 * LINE Webhookリクエストを受信
 * /subscribe, /unsubscribe コマンドでグループを管理
 * @param {Object} e - HTTPリクエストイベント
 */
function doPost(e) {
  try {
    const json = JSON.parse(e.postData.contents);
    Logger.log(`Webhook受信: ${JSON.stringify(json, null, 2)}`);

    // イベント処理
    if (json.events && json.events.length > 0) {
      for (const event of json.events) {
        // メッセージイベントかつグループの場合
        if (event.type === 'message' &&
            event.message.type === 'text' &&
            event.source && event.source.type === 'group') {

          const groupId = event.source.groupId;
          const messageText = event.message.text.trim();

          Logger.log(`グループメッセージ受信: ${groupId}, テキスト: ${messageText}`);

          // /subscribe コマンド
          if (messageText.includes('/subscribe')) {
            const added = addGroupId(groupId);
            if (added) {
              sendReplyMessage(event.replyToken,
                '✅ このグループが通知先として登録されました！\n' +
                'Garmin LiveTrackの通知をこのグループに送信します。');
            } else {
              sendReplyMessage(event.replyToken,
                'ℹ️ このグループは既に通知先として登録されています。');
            }
          }
          // /unsubscribe コマンド
          else if (messageText.includes('/unsubscribe')) {
            const removed = removeGroupId(groupId);
            if (removed) {
              sendReplyMessage(event.replyToken,
                '🔕 このグループの通知登録を解除しました。\n' +
                '再度通知を受け取る場合は /subscribe を送信してください。');
            } else {
              sendReplyMessage(event.replyToken,
                'ℹ️ このグループは通知先として登録されていません。');
            }
          }
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log(`Webhook処理エラー: ${error.message}`);
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * グループIDをスクリプトプロパティに追加（重複チェック付き）
 * @param {string} groupId - グループID
 * @returns {boolean} 追加されたかどうか（true: 新規追加, false: 既存）
 */
function addGroupId(groupId) {
  const props = PropertiesService.getScriptProperties();
  const groupIdsJson = props.getProperty('LINE_GROUP_IDS') || '[]';
  const groupIds = JSON.parse(groupIdsJson);

  // 重複チェック
  if (!groupIds.includes(groupId)) {
    groupIds.push(groupId);
    props.setProperty('LINE_GROUP_IDS', JSON.stringify(groupIds));
    Logger.log(`グループID追加: ${groupId} (合計: ${groupIds.length}グループ)`);
    return true;
  } else {
    Logger.log(`グループID既存: ${groupId}`);
    return false;
  }
}

/**
 * グループIDをスクリプトプロパティから削除
 * @param {string} groupId - グループID
 * @returns {boolean} 削除されたかどうか（true: 削除成功, false: 存在しない）
 */
function removeGroupId(groupId) {
  const props = PropertiesService.getScriptProperties();
  const groupIdsJson = props.getProperty('LINE_GROUP_IDS') || '[]';
  const groupIds = JSON.parse(groupIdsJson);

  const index = groupIds.indexOf(groupId);
  if (index !== -1) {
    groupIds.splice(index, 1);
    props.setProperty('LINE_GROUP_IDS', JSON.stringify(groupIds));
    Logger.log(`グループID削除: ${groupId} (残り: ${groupIds.length}グループ)`);
    return true;
  } else {
    Logger.log(`グループID未登録: ${groupId}`);
    return false;
  }
}

/**
 * グループに返信メッセージを送信（Reply Token使用）
 * @param {string} replyToken - Reply Token
 * @param {string} text - 返信メッセージ
 */
function sendReplyMessage(replyToken, text) {
  const config = getConfig();
  const token = config.LINE_CHANNEL_ACCESS_TOKEN;

  if (!token) {
    Logger.log('警告: トークンが未設定のため返信できません');
    return;
  }

  const url = 'https://api.line.me/v2/bot/message/reply';
  const payload = {
    replyToken: replyToken,
    messages: [{
      type: 'text',
      text: text
    }]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();

    if (statusCode >= 200 && statusCode < 300) {
      Logger.log(`返信メッセージ送信成功`);
    } else {
      Logger.log(`返信メッセージ送信失敗: ${statusCode} - ${response.getContentText()}`);
    }
  } catch (error) {
    Logger.log(`返信メッセージ送信エラー: ${error.message}`);
  }
}
