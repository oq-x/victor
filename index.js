import 'colors';
import yml from "js-yaml";
import fs from "fs";
import express from "express";
import nacl from "tweetnacl";
import fetch from "node-fetch";
const oldDate = Date.now();
import parser from 'body-parser';
import https from 'https';
let content;
if(!process.argv.includes("-i") && !process.argv.includes("--init")){
    try { 
        content = fs.readFileSync('./config.yml', 'utf8')
        console.log(`${'INFO'.blue} Loaded config`)
    } catch {
        console.log(`${'ERROR'.red} Can't read file config.yml`)
        process.exit()
    }
}

async function request(route, method, body){
    let options = { method, headers: {'Content-Type': 'application/json', "Authorization": `Bot ${config.bot.token}`} }
    if(body) options.body = JSON.stringify(body)
    const data = await fetch(`https://discord.com/api/${config.bot.version}${route}`, options)
    return data;
}

if(process.argv.includes("-i") || process.argv.includes("--init")){
    console.log(`${'DEBUG'.yellow} Running with -i flag`)
    console.log(`${'INFO'.blue} Initializing config`)
    try {
        fs.writeFileSync(`./config.yml`, `owner: "" # your id
bot:
  id: "" # your bot id
  public_key: "" # your bot public key
  token: "" # your bot token
  version: "v10" # dont change this
server:
  port: 80 # the webserver port
  ssl:
    key: "key.pem" # your private key location
    cert: "cert.pem" # your certificate location
roles: [
  {
    name: "", # role name
    id: "" # role id
  } # Add more
]
embed:
  content: "Click on the buttons below to get roles!" # embed message
  color: "0059FF" # embed color`, 'utf8')
        console.log(`${'INFO'.blue} Created config`)
        process.exit()
    } catch {
        console.log(`${'ERROR'.red} Couldn't create config`)
        process.exit()
    }
}

const config = yml.load(content)

const app = express()
try {
    https.createServer(config.server.ssl, app).listen(config.server.port, function(){
        console.log(`${'INFO'.blue} Listening on port ${config.port}`)
    })
} catch {
    console.log(`${'ERROR'.red} Can't listen on port ${config.server.port}`)
    process.exit()
}

if(process.argv.includes("-cc") || process.argv.includes("--create-commands")){
    console.log(`${'DEBUG'.yellow} Running with -cc flag`)
    console.log(`${'INFO'.blue} Creating commands`)
    await request(`/applications/${config.bot.id}/commands`, 'put', [
        {
            type: 1,
            name: "send",
            description: "Send the embed message",
            options: [{
                type: 7,
                name: "channel",
                description: "The channel to send the message in",
                required: true,
                channel_types: [0]
            }]
        }
    ])
}
app.use(parser.json({
    verify: (req, res, buf) => {
        req.rawBody = buf
    }
}))


function authenticate(request, response){
    const signature = request.get('X-Signature-Ed25519');
    const timestamp = request.get('X-Signature-Timestamp')
    if(!signature || !timestamp) {
        response.status(400).send("missing signature")
        return false
    }
    const isVerified = nacl.sign.detached.verify(
        Buffer.from(timestamp + Buffer.from(request.rawBody)),
        Buffer.from(signature, 'hex'),
        Buffer.from(config.bot.public_key, 'hex')
    )
    if(!isVerified){
        response.status(401).send("invalid request signature")
        return false;
    }
    response.setHeader('content-type', 'application/json');
    if(request.body.type === 1) response.json({ type: 1 })
}

app.post("/interactions", async function(req, response){
    let success = authenticate(req, response)
    if(success === false) return;
    const interaction = req.body;
    interaction.reply = async (data) => {
        if(data.ephemeral) {
            delete data.ephemeral;
            data.flags = 1 << 6
        }
        response.json({ type: 4, data: data })
    }
    interaction.deferReply = async (ephemeral) => {
        if(ephemeral){
            response.json({ type: 5, data: { flags: 1 << 6 } })
        } else {
            response.json({ type: 5 })
        }
    }
    interaction.editReply = async(data) => {
        await request(`/webhooks/${config.bot.id}/${interaction.token}/messages/@original`, 'patch', data)
    }
    interaction.deleteReply = async() =>{
        await request(`/webhooks/${config.bot.id}/${interaction.token}/messages/@original`, 'patch')
    }
    if(interaction.type === 3 && interaction.data.component_type === 2){
        const guild = interaction.guild_id 
        if(!guild) return await interaction.reply({ content: "This interaction must run in a guild!", ephemeral: true })
        await interaction.deferReply(true)
        const member = interaction.member.user.id
        const payload = await request(`/guilds/${guild}/members/${member}`, 'get')
        const memberData = await payload.json()
        const role = interaction.data.custom_id
        if(memberData.roles.includes(role)){
            await request(`/guilds/${guild}/members/${member}/roles/${role}`, 'delete')
            await interaction.editReply({ content: `I removed this role from you.` })
        }else{
            await request(`/guilds/${guild}/members/${member}/roles/${role}`, 'put')
            await interaction.editReply({ content: `I added this role to you.` })
        }
    }else if(interaction.type === 2 && interaction.data.name === "send"){
        const guild = interaction.guild_id 
        if(!guild) return await interaction.reply({ content: "This interaction must run in a guild!", ephemeral: true })
        await interaction.deferReply()
        const user = interaction.member.user.id
        if(user !== config.owner) return await interaction.editReply({ content: "You are not cool enough to run this command!" })
        const message = config.embed.content
        const hex = parseInt(config.embed.color, 16)
        const payload = {
            color: hex,
            description: message
        }
        const buttons = config.roles.map((role) => ({ style: 1, custom_id: role.id, label: role.name, type: 2 }))
        await request(`/channels/${interaction.data.options[0].value}/messages`, 'post', { embeds: [payload], components: [{ type: 1, components: buttons }] })
        await interaction.editReply({ content: "Sent message!" })
    }


})
console.log(`${'DONE'.green} (${(new Date().getSeconds() - new Date(oldDate).getSeconds()).toFixed(2)}s) Victor is running`)
