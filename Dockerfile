FROM node:22-alpine

WORKDIR /app

COPY package.json server.mjs ./
COPY lib ./lib
COPY public ./public
COPY config ./config
COPY scripts ./scripts
COPY data ./data

RUN chown -R node:node /app/config /app/data

ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

USER node

CMD ["node", "server.mjs"]
