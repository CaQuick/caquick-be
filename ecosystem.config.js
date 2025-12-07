module.exports = {
  apps: [
    {
      name: 'backend-blue',
      cwd: '/home/ubuntu/project/caquick-backend/blue',
      script: 'dist/main.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1600M',
      out_file: '/home/ubuntu/.pm2/logs/backend-blue-out.log',
      error_file: '/home/ubuntu/.pm2/logs/backend-blue-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm Z',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        PROFILE: 'blue'
      },
    },
    {
      name: 'backend-green',
      cwd: '/home/ubuntu/project/caquick-backend/green',
      script: 'dist/main.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1600M',
      out_file: '/home/ubuntu/.pm2/logs/backend-green-out.log',
      error_file: '/home/ubuntu/.pm2/logs/backend-green-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm Z',
      env: {
        NODE_ENV: 'production',
        PORT: 4001,
        PROFILE: 'green'
      },
    },
  ],
};
