import {PortMapping} from './port-mapping'
import {Out} from '@snickbit/out'
import {cleanServerName} from './common'

export interface ServerInfo {
	Id: string
	Name?: string
	Config?: {
		Labels: {
			[key: string]: string
		}
	}
	NetworkSettings: {
		Ports: {
			[key: string]: {
				HostIp: string
				HostPort: string
			}[]
		}
		Networks: {
			[key: string]: {
				IPAddress: string
			}
		}
	}
}

export class Server {
	readonly name: string
	readonly ipAddress: string
	readonly internalPort: number
	readonly privatePort: number
	portMappings: PortMapping[]
	id: any
	out: Out

	constructor(info: ServerInfo) {
		this.id = info.Id
		this.name = cleanServerName(info.Name || 'Unknown')
		this.ipAddress = null
		this.internalPort = null
		this.privatePort = null
		this.portMappings = []

		this.out = new Out(this.name)

		const configuredInternalPort = info.Config.Labels['polymine.internal-port']
		if (configuredInternalPort) {
			this.internalPort = parseInt(configuredInternalPort)
		}

		for (const [key, entries] of Object.entries(info.NetworkSettings.Ports)) {
			if (key && entries) {
				const matches = key.match(/^(\d+)\/udp$/)
				if (matches) {
					const internalPort = parseInt(matches[1])
					if (!this.privatePort) {
						this.privatePort = internalPort
					}
					if (entries.length > 0 && entries[0].HostPort) {
						this.portMappings.push(new PortMapping(internalPort, parseInt(entries[0].HostPort)))
					}
				}
			}
		}

		for (const network of Object.values(info.NetworkSettings.Networks)) {
			if (network.IPAddress) {
				this.ipAddress = network.IPAddress
				break
			}
		}

		if (this.privatePort) {
			this.out.prefix(`${this.name}:${this.privatePort}`)
		}
	}

	equalTo(other): boolean {
		return this.id === other.id &&
			this.name === other.name &&
			this.ipAddress === other.ipAddress &&
			this.internalPort === other.internalPort &&
			this.portMappings.length === other.portMappings.length &&
			this.portMappings.every((m, i) => m.equalTo(other.portMappings[i]))
	}
}
