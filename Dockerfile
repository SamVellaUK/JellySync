FROM node:18-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY index.js ./
COPY lib ./lib
COPY config.json.template ./
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh
EXPOSE 9500
ENTRYPOINT ["/app/entrypoint.sh"]
