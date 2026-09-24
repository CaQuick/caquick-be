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
    // worker(outbox 디스패처·크론)는 프로세스 1개만 — application_start가 반대편 worker를 먼저 멈추고 띄운다.
    // 07(compose 전환)에서 이 파일과 함께 사라진다.
    {
      name: 'worker-blue',
      cwd: '/home/ubuntu/project/caquick-backend/blue',
      script: 'dist/main.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1024M',
      out_file: '/home/ubuntu/.pm2/logs/worker-blue-out.log',
      error_file: '/home/ubuntu/.pm2/logs/worker-blue-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm Z',
      env: {
        NODE_ENV: 'production',
        APP_ROLE: 'worker',
        PORT: 4002,
        PROFILE: 'blue'
      },
    },
    {
      name: 'worker-green',
      cwd: '/home/ubuntu/project/caquick-backend/green',
      script: 'dist/main.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1024M',
      out_file: '/home/ubuntu/.pm2/logs/worker-green-out.log',
      error_file: '/home/ubuntu/.pm2/logs/worker-green-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm Z',
      env: {
        NODE_ENV: 'production',
        APP_ROLE: 'worker',
        PORT: 4003,
        PROFILE: 'green'
      },
    },
  ],
};
