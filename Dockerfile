# Bun serves src/index.ts directly — no compile step, so a single stage is enough.
FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

EXPOSE 3000
CMD ["bun", "run", "start"]
