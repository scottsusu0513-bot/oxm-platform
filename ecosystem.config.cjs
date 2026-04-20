module.exports = {
  apps: [
    {
      name: "oxm",
      script: "./dist/index.js",
      instances: "max",        // 自動使用全部 CPU 核心
      exec_mode: "cluster",
      env_production: {
        NODE_ENV: "production",
      },
      // 記憶體超過 512MB 自動重啟（防止記憶體洩漏）
      max_memory_restart: "512M",
      // 錯誤日誌
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      // 自動重啟
      autorestart: true,
      watch: false,
    },
  ],
};
