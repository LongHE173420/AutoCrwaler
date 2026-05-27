module.exports = {
  apps: [
    {
      name: "tiktoke-crawler1",
      cwd: __dirname,
      script: "dist/index.js",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
