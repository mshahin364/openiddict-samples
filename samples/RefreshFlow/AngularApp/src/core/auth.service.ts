import { Injectable } from '@angular/core';
import { Http, Headers, RequestOptions, Response, URLSearchParams } from '@angular/http';
import { Observable } from 'rxjs/Observable';
import { Subscription } from 'rxjs/Subscription';
import { BehaviorSubject } from 'rxjs/BehaviorSubject';
import { RefreshGrantModel } from './models/refresh-grant-model';
import { ProfileModel } from './models/profile-model';
import { AuthStateModel } from './models/auth-state-model';
import { AuthTokenModel } from './models/auth-tokens-model';
import { RegisterModel } from './models/register-model';
import { LoginModel } from './models/login-model';

const jwtDecode = require('jwt-decode');

import 'rxjs/add/operator/map';
import 'rxjs/add/operator/mergeMap';
import 'rxjs/add/operator/first';
import 'rxjs/add/operator/catch';
import 'rxjs/add/operator/do';
import 'rxjs/add/operator/filter';

import 'rxjs/add/observable/of';
import 'rxjs/add/observable/interval';
import 'rxjs/add/observable/throw';

@Injectable()
export class AuthService {

    private initalState: AuthStateModel = { profile: null, tokens: null, authReady: false };
    private authReady$ = new BehaviorSubject<boolean>(false);
    private state: BehaviorSubject<AuthStateModel>;
    private refreshSubscription$: Subscription;

    state$: Observable<AuthStateModel>;
    tokens$: Observable<AuthTokenModel>;
    profile$: Observable<ProfileModel>;
    loggedIn$: Observable<boolean>;

    constructor(
        private http: Http,
    ) {
        this.state = new BehaviorSubject<AuthStateModel>(this.initalState);
        this.state$ = this.state.asObservable();

        this.tokens$ = this.state.filter(state => state.authReady)
            .map(state => state.tokens);

        this.profile$ = this.state.filter(state => state.authReady)
            .map(state => state.profile);

        this.loggedIn$ = this.tokens$.map(tokens => !!tokens);
    }

    init(): Observable<AuthTokenModel> {
        return this.startupTokenRefresh()
            .do(() => this.scheduleRefresh());
    }

    register(data: RegisterModel): Observable<Response> {
        return this.http.post('http://localhost:5056/account/register', data)
            .catch(res => Observable.throw(res.json()));
    }

    login(user: LoginModel): Observable<any> {
        return this.getTokens(user, 'password')
            .catch(res => Observable.throw(res.json()))
            .do(res => this.scheduleRefresh());
    }

    logout(): void {
        this.updateState({ profile: null, tokens: null });
        if (this.refreshSubscription$) {
            this.refreshSubscription$.unsubscribe();
        }
        this.removeToken();
    }

    isInRole(usersRole: string): Observable<boolean> {
        return this.profile$
            .map(profile => profile.role.find(role => role === usersRole) !== undefined);
    }

    refreshTokens(): Observable<AuthTokenModel> {
        return this.state.first()
            .map(state => state.tokens)
            .flatMap(tokens => this.getTokens({ refresh_token: tokens.refresh_token }, 'refresh_token')
                .catch(error => Observable.throw('Session Expired'))
            );
    }

    private storeToken(tokens: AuthTokenModel): void {
        localStorage.setItem('auth-tokens', JSON.stringify(tokens));
    }

    private retrieveTokens(): AuthTokenModel {
        const tokensString = localStorage.getItem('auth-tokens');
        const tokensModel: AuthTokenModel = tokensString == null ? null : JSON.parse(tokensString);
        return tokensModel;
    }

    private removeToken(): void {
        localStorage.removeItem('auth-tokens');
    }

    private updateState(newState: AuthStateModel): void {
        const previoudState = this.state.getValue();
        this.state.next(Object.assign({}, previoudState, newState));
    }

    private getTokens(data: RefreshGrantModel | LoginModel, grantType: string): Observable<Response> {
        const headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded' });
        const options = new RequestOptions({ headers: headers });

        Object.assign(data, { grant_type: grantType, scope: 'openid offline_access' });

        const params = new URLSearchParams();
        Object.keys(data).forEach(key => params.append(key, (<any>data)[key]));

        return this.http.post('http://localhost:5056/connect/token', params.toString(), options)
            .map(res => {
                const tokens: AuthTokenModel = res.json();
                const now = new Date();
                tokens.expiration_date = new Date(now.getTime() + tokens.expires_in * 1000).getTime().toString();

                const profile: ProfileModel = jwtDecode(tokens.id_token);

                this.storeToken(tokens);
                this.updateState({ authReady: true, tokens, profile });
                return res;
            });
    }

    private startupTokenRefresh(): Observable<AuthTokenModel> {
        return Observable.of(this.retrieveTokens())
            .flatMap((tokens: AuthTokenModel) => {
                if (!tokens) {
                    this.updateState({ authReady: true });
                    return Observable.throw('No token in Storage');
                }
                const profile: ProfileModel = jwtDecode(tokens.id_token);
                this.updateState({ tokens, profile });

                if (+tokens.expiration_date > new Date().getTime()) {
                    this.updateState({ authReady: true });
                }

                return this.refreshTokens();
            })
            .catch(error => {
                this.logout();
                this.updateState({ authReady: true });
                return Observable.throw(error);
            });
    }

    private scheduleRefresh(): void {
        this.refreshSubscription$ = this.tokens$
            .first()
            .flatMap(tokens => Observable.interval(tokens.expires_in / 2 * 1000))
            .flatMap(() => this.refreshTokens())
            .subscribe();
    }
}

