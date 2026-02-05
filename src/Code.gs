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

        // 既読処理
        markAsRead(message.thread);

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
        messages.push({
          thread: thread,
          from: msg.getFrom(),
          date: msg.getDate(),
          subject: msg.getSubject(),
          body: msg.getPlainBody(),
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
  const url = 'https://api.line.me/v2/bot/message/broadcast';

  // 本文を制限
  let body = message.body;
  if (body.length > config.MAX_BODY_LENGTH) {
    body = body.substring(0, config.MAX_BODY_LENGTH) + '...（省略）';
  }

  // メッセージ整形
  const text = [
    `【新着メール通知】`,
    ``,
    `[差出人]`,
    message.from,
    ``,
    `[日時]`,
    Utilities.formatDate(message.date, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss'),
    ``,
    `[件名]`,
    message.subject,
    ``,
    `[本文]`,
    body
  ];

  if (message.attachmentCount > 0) {
    text.push('', `📎 添付ファイル: ${message.attachmentCount}件`);
  }

  const payload = {
    messages: [{
      type: 'text',
      text: text.join('\n')
    }]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': `Bearer ${config.LINE_CHANNEL_ACCESS_TOKEN}`
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const statusCode = response.getResponseCode();

  if (statusCode !== 200) {
    throw new Error(`LINE API Error: ${statusCode} - ${response.getContentText()}`);
  }
}

/**
 * スレッドを既読にする
 * @param {GmailThread} thread - Gmailスレッド
 */
function markAsRead(thread) {
  thread.markRead();
  Logger.log(`既読処理完了: Thread ID ${thread.getId()}`);
}
