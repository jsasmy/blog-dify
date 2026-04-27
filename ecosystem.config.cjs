module.exports = {
  apps: [
    {
      name: 'simple-blog',
      script: 'server/index.js',
      cwd: '/var/www/simple-blog',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
    },
  ],
}
