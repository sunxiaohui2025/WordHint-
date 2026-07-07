// WordHint LLM Configuration Template
// 复制此文件为 config.js 并填入你的实际配置
// 注意：config.js 已加入 .gitignore，可安全存储敏感信息

export const LLM_CONFIG = {
  // vLLM API 基础地址（不含模型名称）
  BASE_URL: 'http://your-server:port',
  
  // 模型名称
  MODEL: 'your-model-name',
  
  // API Key
  API_KEY: 'your-api-key',
  
  // 关闭思维链（必须为 false，否则请求会超时）
  ENABLE_THINKING: false,
  
  // 温度参数
  TEMPERATURE: 0,
  
  // 释义请求最大 token 数
  MAX_TOKENS: 500,
  
  // 划词翻译最大 token 数
  MAX_TOKENS_SELECTION: 600
};
