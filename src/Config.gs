/**
 * 設定管理
 * スクリプトプロパティから設定を取得する
 */

/**
 * 設定オブジェクトを取得
 * @returns {Object} 設定オブジェクト
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  const gmailLabel = props.getProperty('GMAIL_LABEL') || 'Garmin-LiveTrack';
  const maxBodyLength = parseInt(props.getProperty('MAX_BODY_LENGTH') || '500');

  // LINE送信先グループIDリストを取得
  const groupIdsJson = props.getProperty('LINE_GROUP_IDS') || '[]';
  const groupIds = JSON.parse(groupIdsJson);

  return {
    LINE_CHANNEL_ACCESS_TOKEN: props.getProperty('LINE_CHANNEL_ACCESS_TOKEN'),
    LINE_GROUP_IDS: groupIds,  // 追加（配列形式）
    GMAIL_LABEL: gmailLabel,
    GMAIL_QUERY: `is:unread label:${gmailLabel} replyto:noreply@garmin.com subject:LiveTrack`,
    MAX_BODY_LENGTH: maxBodyLength
  };
}
