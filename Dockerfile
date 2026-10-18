FROM node:24-alpine
WORKDIR /app
COPY . .
RUN mkdir /data && chown node:node /data
USER node
ENV PORT=4173 DATA_DIR=/data
EXPOSE 4173
CMD ["node", "server.mjs"]
