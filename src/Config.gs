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

  return {
    LINE_CHANNEL_ACCESS_TOKEN: props.getProperty('LINE_CHANNEL_ACCESS_TOKEN'),
    GMAIL_LABEL: gmailLabel,
    GMAIL_QUERY: `is:unread label:${gmailLabel} replyto:noreply@garmin.com subject:LiveTrack`,
    MAX_BODY_LENGTH: maxBodyLength
  };
}
